// Restaurant (tenant) API — part 2: inventory, recipes, purchases & suppliers, accounting, reports, dashboard
const express = require('express');
const db = require('./db');
const c = require('./core');
const O = require('./orders');
const { wrap, fail, str, num, int, r2, requireUser: U } = c;
const r = express.Router();

const tz = req => req.tenant.settings.timezone || 'Asia/Dhaka';
const today = req => O.localNow(tz(req)).date;
// branch filter: owners / all-branch users may pass ?branch=all
function br(req, col, p) {
  if (req.query.branch === 'all' && !req.user.branch_id) return '';
  if (int(req.query.branch) && !req.user.branch_id) { p.push(int(req.query.branch)); return ` AND ${col}=$${p.length}`; }
  p.push(req.branchId); return ` AND ${col}=$${p.length}`;
}
function rangeOf(req) {
  const t = today(req);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : t;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : t;
  return { from, to };
}
function dr(req, col, p) { const { from, to } = rangeOf(req); p.push(tz(req), from, to); return ` AND (${col} AT TIME ZONE $${p.length - 2})::date BETWEEN $${p.length - 1} AND $${p.length}`; }

async function moveStock(t, tid, branchId, ingId, qty, type, extra = {}) {
  const before = await t.one('SELECT qty FROM stock WHERE branch_id=$1 AND ingredient_id=$2', [branchId, ingId]);
  await t.q(`INSERT INTO stock(tenant_id,branch_id,ingredient_id,qty) VALUES($1,$2,$3,$4) ON CONFLICT(branch_id,ingredient_id) DO UPDATE SET qty=stock.qty+$4`, [tid, branchId, ingId, qty]);
  await t.q(`INSERT INTO stock_moves(tenant_id,branch_id,ingredient_id,type,qty,unit_cost,ref,batch,expiry,note,user_id,system_qty) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [tid, branchId, ingId, type, qty, extra.unit_cost ?? null, extra.ref || null, extra.batch || null, extra.expiry || null, extra.note || null, extra.user_id || null, before ? before.qty : 0]);
  return before ? num(before.qty) : 0;
}

// ================= inventory =================
r.get('/stock', U(['inventory', 'recipes', 'purchases']), wrap(async (req, res) => {
  if (req.query.branch === 'all' && !req.user.branch_id) {
    const branches = await db.all('SELECT id, name FROM branches WHERE tenant_id=$1 ORDER BY id', [req.tid]);
    const ings = await db.all(`SELECT i.*, COALESCE((SELECT json_object_agg(s.branch_id, s.qty) FROM stock s WHERE s.ingredient_id=i.id),'{}') by_branch,
      COALESCE((SELECT sum(qty) FROM stock s WHERE s.ingredient_id=i.id),0) qty FROM ingredients i WHERE i.tenant_id=$1 ORDER BY i.name`, [req.tid]);
    ings.forEach(i => { i.value = r2(num(i.qty) * num(i.cost)); i.low = num(i.min_stock) > 0 && num(i.qty) <= num(i.min_stock); });
    return res.json({ branches, items: ings });
  }
  const items = await db.all(`SELECT i.*, COALESCE(s.qty,0) qty FROM ingredients i LEFT JOIN stock s ON s.ingredient_id=i.id AND s.branch_id=$2 WHERE i.tenant_id=$1 ORDER BY i.name`, [req.tid, req.branchId]);
  items.forEach(i => { i.value = r2(num(i.qty) * num(i.cost)); i.low = num(i.min_stock) > 0 && num(i.qty) <= num(i.min_stock); });
  res.json({ items, total_value: r2(items.reduce((s, i) => s + (num(i.qty) > 0 ? i.value : 0), 0)), low: items.filter(i => i.low && i.active).length });
}));
const MOVE_TYPES = { in: 1, out: -1, adjust: 0, waste: -1, damage: -1, return_supplier: -1, staff_meal: -1, opening: 1 };
r.post('/stock/move', U('inventory'), wrap(async (req, res) => {
  const b = req.body || {};
  if (!(b.type in MOVE_TYPES)) fail(400, 'Choose a movement type');
  const ing = await db.one('SELECT * FROM ingredients WHERE id=$1 AND tenant_id=$2', [int(b.ingredient_id), req.tid]);
  if (!ing) fail(400, 'Choose an ingredient');
  let qty = num(b.qty);
  if (b.unit_mode === 'purchase') qty = qty * num(ing.conversion, 1);
  if (MOVE_TYPES[b.type] !== 0) { if (!(qty > 0)) fail(400, 'Quantity must be more than 0'); qty = qty * MOVE_TYPES[b.type]; }
  if (!qty) fail(400, 'Quantity cannot be 0');
  await db.tx(t => moveStock(t, req.tid, req.branchId, ing.id, qty, b.type, { ref: str(b.ref, 80), batch: str(b.batch, 60), expiry: b.expiry || null, note: str(b.note, 300), user_id: req.user.id, unit_cost: ing.cost }));
  await c.audit(req, 'stock-' + b.type, 'ingredient', ing.id, { qty });
  res.json({ ok: true });
}));
r.post('/stock/count', U('inventory'), wrap(async (req, res) => {
  const items = (req.body.items || []).filter(i => i.counted !== '' && i.counted !== null && i.counted !== undefined);
  if (!items.length) fail(400, 'Enter counted quantities');
  let changed = 0;
  await db.tx(async t => {
    for (const i of items) {
      const ing = await t.one('SELECT id, cost FROM ingredients WHERE id=$1 AND tenant_id=$2', [int(i.ingredient_id), req.tid]);
      if (!ing) continue;
      const cur = await t.one('SELECT qty FROM stock WHERE branch_id=$1 AND ingredient_id=$2', [req.branchId, ing.id]);
      const diff = num(i.counted) - (cur ? num(cur.qty) : 0);
      if (Math.abs(diff) < 0.0005) continue;
      await moveStock(t, req.tid, req.branchId, ing.id, diff, 'count', { note: 'Physical count: ' + num(i.counted), user_id: req.user.id, unit_cost: ing.cost, ref: str(req.body.ref, 80) || 'Stock count' });
      changed++;
    }
  });
  await c.audit(req, 'stock-count', 'inventory', null, { items: changed });
  res.json({ ok: true, changed });
}));
r.post('/stock/transfer', U('inventory'), wrap(async (req, res) => {
  if (req.user.branch_id && !c.can(req, 'branches')) { /* branch users can send from their own branch */ }
  const to = await db.one('SELECT id, name FROM branches WHERE id=$1 AND tenant_id=$2', [int(req.body.to_branch), req.tid]);
  if (!to || to.id === req.branchId) fail(400, 'Choose another branch to send to');
  const from = await db.one('SELECT name FROM branches WHERE id=$1', [req.branchId]);
  const items = (req.body.items || []).filter(i => num(i.qty) > 0);
  if (!items.length) fail(400, 'Add items to transfer');
  await db.tx(async t => {
    for (const i of items) {
      const ing = await t.one('SELECT id, cost FROM ingredients WHERE id=$1 AND tenant_id=$2', [int(i.ingredient_id), req.tid]);
      if (!ing) continue;
      await moveStock(t, req.tid, req.branchId, ing.id, -num(i.qty), 'transfer_out', { ref: 'To ' + to.name, user_id: req.user.id, unit_cost: ing.cost, note: str(req.body.note, 300) });
      await moveStock(t, req.tid, to.id, ing.id, num(i.qty), 'transfer_in', { ref: 'From ' + from.name, user_id: req.user.id, unit_cost: ing.cost, note: str(req.body.note, 300) });
    }
  });
  await c.notify(req.tid, to.id, 'stock', 'Stock received', `${items.length} item(s) transferred from ${from.name}`, '#/inventory');
  await c.audit(req, 'transfer', 'inventory', null, { to: to.name, items: items.length });
  res.json({ ok: true });
}));
r.get('/stock/moves', U(['inventory', 'reports']), wrap(async (req, res) => {
  const p = [req.tid]; let w = 'm.tenant_id=$1' + br(req, 'm.branch_id', p);
  if (int(req.query.ingredient_id)) { p.push(int(req.query.ingredient_id)); w += ` AND m.ingredient_id=$${p.length}`; }
  if (req.query.type) { p.push(req.query.type); w += ` AND m.type=$${p.length}`; }
  if (req.query.from || req.query.to) w += dr(req, 'm.created_at', p);
  res.json(await db.all(`SELECT m.*, i.name ingredient, i.unit, u.name user_name FROM stock_moves m JOIN ingredients i ON i.id=m.ingredient_id LEFT JOIN users u ON u.id=m.user_id WHERE ${w} ORDER BY m.id DESC LIMIT 500`, p));
}));
r.get('/stock/expiring', U('inventory'), wrap(async (req, res) => {
  const days = int(req.query.days, 7);
  res.json(await db.all(`SELECT m.batch, m.expiry, m.qty, i.name, i.unit, m.ref, m.created_at FROM stock_moves m JOIN ingredients i ON i.id=m.ingredient_id
    WHERE m.tenant_id=$1 AND m.branch_id=$2 AND m.expiry IS NOT NULL AND m.qty>0 AND m.expiry <= (now() AT TIME ZONE $4)::date + $3::int
      AND COALESCE((SELECT qty FROM stock s WHERE s.branch_id=m.branch_id AND s.ingredient_id=m.ingredient_id),0) > 0
    ORDER BY m.expiry`, [req.tid, req.branchId, days, tz(req)]));
}));
// theoretical (recipe based) vs actual usage
r.get('/stock/variance', U(['inventory', 'reports']), wrap(async (req, res) => {
  const p = [req.tid]; const w = br(req, 'm.branch_id', p) + dr(req, 'm.created_at', p);
  res.json(await db.all(`SELECT i.id, i.name, i.unit, i.cost,
      -COALESCE(sum(m.qty) FILTER (WHERE m.type='sale'),0) theoretical,
      -COALESCE(sum(m.qty) FILTER (WHERE m.type IN ('sale','waste','damage','staff_meal','count','adjust')),0) actual,
      -COALESCE(sum(m.qty) FILTER (WHERE m.type IN ('waste','damage')),0) wasted,
      -COALESCE(sum(m.qty) FILTER (WHERE m.type IN ('count','adjust')),0) count_diff
    FROM ingredients i JOIN stock_moves m ON m.ingredient_id=i.id WHERE i.tenant_id=$1 ${w} GROUP BY i.id ORDER BY i.name`, p));
}));
r.get('/ingredients/:id/price-history', U(['inventory', 'purchases']), wrap(async (req, res) => {
  res.json(await db.all(`SELECT pi.unit_cost, pi.qty, p.date, p.invoice_no, s.name supplier FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id LEFT JOIN suppliers s ON s.id=p.supplier_id
    WHERE pi.tenant_id=$1 AND pi.ingredient_id=$2 AND p.type='purchase' ORDER BY p.date DESC, p.id DESC LIMIT 50`, [req.tid, int(req.params.id)]));
}));

// ================= recipes & food cost =================
r.get('/recipes', U(['recipes', 'menu', 'reports']), wrap(async (req, res) => {
  const rows = await db.all(`SELECT p.id, p.name, p.price, p.active, cat.name category,
      COALESCE((SELECT sum(r.qty / NULLIF(i.yield_pct,0) * 100 * i.cost) FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.product_id=p.id),0) cost,
      (SELECT count(*)::int FROM recipes r WHERE r.product_id=p.id) ingredients
    FROM products p LEFT JOIN categories cat ON cat.id=p.category_id WHERE p.tenant_id=$1 ORDER BY cat.sort NULLS LAST, p.name`, [req.tid]);
  rows.forEach(x => { x.cost = r2(x.cost); x.profit = r2(num(x.price) - x.cost); x.food_cost_pct = num(x.price) > 0 ? r2(x.cost / num(x.price) * 100) : 0; });
  res.json(rows);
}));
r.get('/recipes/:pid', U(['recipes', 'menu']), wrap(async (req, res) => {
  const p = await db.one('SELECT id, name, price, variants FROM products WHERE id=$1 AND tenant_id=$2', [int(req.params.pid), req.tid]);
  if (!p) fail(404, 'Product not found');
  const items = await db.all(`SELECT r.id, r.ingredient_id, r.qty, i.name, i.unit, i.cost, i.yield_pct FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.product_id=$1 ORDER BY r.id`, [p.id]);
  const versions = await db.all('SELECT v.id, v.cost, v.note, v.created_at, v.items, u.name user_name FROM recipe_versions v LEFT JOIN users u ON u.id=v.user_id WHERE v.product_id=$1 AND v.tenant_id=$2 ORDER BY v.id DESC LIMIT 20', [p.id, req.tid]);
  res.json({ product: p, items, versions });
}));
async function saveRecipe(req, pid, list, note) {
  const p = await db.one('SELECT id FROM products WHERE id=$1 AND tenant_id=$2', [pid, req.tid]);
  if (!p) fail(404, 'Product not found');
  return db.tx(async t => {
    const prev = await t.all('SELECT r.ingredient_id, r.qty, i.name, i.unit FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.product_id=$1', [pid]);
    await t.q('DELETE FROM recipes WHERE product_id=$1 AND tenant_id=$2', [pid, req.tid]);
    let cost = 0;
    for (const it of list || []) {
      const ing = await t.one('SELECT id, cost, yield_pct FROM ingredients WHERE id=$1 AND tenant_id=$2', [int(it.ingredient_id), req.tid]);
      if (!ing || !(num(it.qty) > 0)) continue;
      await t.q('INSERT INTO recipes(tenant_id,product_id,ingredient_id,qty) VALUES($1,$2,$3,$4)', [req.tid, pid, ing.id, num(it.qty)]);
      cost += num(it.qty) / (num(ing.yield_pct, 100) / 100 || 1) * num(ing.cost);
    }
    if (prev.length) await t.q('INSERT INTO recipe_versions(tenant_id,product_id,items,cost,note,user_id) VALUES($1,$2,$3,$4,$5,$6)', [req.tid, pid, JSON.stringify(prev), null, str(note, 200) || 'Before edit', req.user.id]);
    return r2(cost);
  });
}
r.put('/recipes/:pid', U('recipes'), wrap(async (req, res) => {
  const cost = await saveRecipe(req, int(req.params.pid), req.body.items, req.body.note);
  await c.audit(req, 'update', 'recipe', int(req.params.pid), { cost });
  res.json({ ok: true, cost });
}));
r.post('/recipes/:pid/restore/:vid', U('recipes'), wrap(async (req, res) => {
  const v = await db.one('SELECT items FROM recipe_versions WHERE id=$1 AND tenant_id=$2 AND product_id=$3', [int(req.params.vid), req.tid, int(req.params.pid)]);
  if (!v) fail(404, 'Version not found');
  const cost = await saveRecipe(req, int(req.params.pid), v.items, 'Before restore');
  res.json({ ok: true, cost });
}));
// replace one ingredient with another across all recipes (ingredient substitution)
r.post('/recipes/substitute', U('recipes'), wrap(async (req, res) => {
  const a = int(req.body.from_id), b = int(req.body.to_id), f = num(req.body.factor, 1) || 1;
  const ok = await db.one('SELECT count(*)::int n FROM ingredients WHERE tenant_id=$1 AND id = ANY($2::int[])', [req.tid, [a, b]]);
  if (ok.n !== 2) fail(400, 'Choose two ingredients');
  const r0 = await db.q('UPDATE recipes SET ingredient_id=$3, qty=qty*$4 WHERE tenant_id=$1 AND ingredient_id=$2', [req.tid, a, b, f]);
  await c.audit(req, 'substitute', 'recipe', null, { from: a, to: b, factor: f });
  res.json({ ok: true, updated: r0.rowCount });
}));

// ================= purchases & suppliers =================
r.get('/purchases', U(['purchases', 'suppliers', 'accounting']), wrap(async (req, res) => {
  const p = [req.tid]; let w = 'p.tenant_id=$1' + br(req, 'p.branch_id', p);
  if (int(req.query.supplier_id)) { p.push(int(req.query.supplier_id)); w += ` AND p.supplier_id=$${p.length}`; }
  if (req.query.status) { p.push(req.query.status); w += ` AND p.status=$${p.length}`; }
  if (req.query.from) { p.push(req.query.from); w += ` AND p.date >= $${p.length}`; }
  if (req.query.to) { p.push(req.query.to); w += ` AND p.date <= $${p.length}`; }
  res.json(await db.all(`SELECT p.*, s.name supplier_name, u.name user_name, (p.total - p.paid) due FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN users u ON u.id=p.user_id WHERE ${w} ORDER BY p.date DESC, p.id DESC LIMIT 500`, p));
}));
r.get('/purchases/:id', U(['purchases', 'suppliers', 'accounting']), wrap(async (req, res) => {
  const p = await db.one(`SELECT p.*, s.name supplier_name, s.phone supplier_phone, s.address supplier_address, u.name user_name, ap.name approved_name, b.name branch_name
    FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN users u ON u.id=p.user_id LEFT JOIN users ap ON ap.id=p.approved_by LEFT JOIN branches b ON b.id=p.branch_id
    WHERE p.id=$1 AND p.tenant_id=$2`, [int(req.params.id), req.tid]);
  if (!p) fail(404, 'Not found');
  p.items = await db.all('SELECT pi.*, i.name, i.unit FROM purchase_items pi JOIN ingredients i ON i.id=pi.ingredient_id WHERE pi.purchase_id=$1 ORDER BY pi.id', [p.id]);
  p.payments = await db.all('SELECT * FROM supplier_payments WHERE purchase_id=$1 ORDER BY id', [p.id]);
  res.json(p);
}));
async function receiveStock(t, req, p) {
  const items = await t.all('SELECT * FROM purchase_items WHERE purchase_id=$1', [p.id]);
  const sign = p.type === 'return' ? -1 : 1;
  for (const it of items) {
    await moveStock(t, req.tid, p.branch_id, it.ingredient_id, sign * num(it.qty), p.type === 'return' ? 'return_supplier' : 'purchase',
      { unit_cost: it.unit_cost, ref: (p.type === 'return' ? 'Return ' : 'GRN ') + (p.ref_no || p.id), batch: it.batch, expiry: it.expiry, user_id: req.user.id });
    if (p.type === 'purchase' && num(it.unit_cost) > 0) await t.q('UPDATE ingredients SET cost=$2 WHERE id=$1', [it.ingredient_id, num(it.unit_cost)]);
  }
  await t.q(`UPDATE purchases SET status='received', received_at=now() WHERE id=$1`, [p.id]);
}
r.post('/purchases', U('purchases'), wrap(async (req, res) => {
  const b = req.body || {};
  const type = b.type === 'return' ? 'return' : 'purchase';
  const status = type === 'return' ? 'received' : (b.status === 'ordered' ? 'ordered' : 'received');
  const sup = int(b.supplier_id) ? await db.one('SELECT id FROM suppliers WHERE id=$1 AND tenant_id=$2', [int(b.supplier_id), req.tid]) : null;
  if (!sup) fail(400, 'Choose a supplier');
  const lines = [];
  for (const it of b.items || []) {
    const ing = await db.one('SELECT * FROM ingredients WHERE id=$1 AND tenant_id=$2', [int(it.ingredient_id), req.tid]);
    if (!ing || !(num(it.qty) > 0)) continue;
    let qty = num(it.qty), cost = num(it.unit_cost);
    if (it.unit_mode === 'purchase' && num(ing.conversion, 1) !== 1) { qty = qty * num(ing.conversion); cost = cost / num(ing.conversion); }
    lines.push({ ing: ing.id, qty, cost, total: r2(num(it.qty) * num(it.unit_cost)), batch: str(it.batch, 60), expiry: it.expiry || null });
  }
  if (!lines.length) fail(400, 'Add at least one item with quantity');
  const subtotal = r2(lines.reduce((s, l) => s + l.total, 0));
  const discount = Math.min(num(b.discount), subtotal);
  const total = r2(subtotal - discount);
  const paid = Math.min(Math.max(0, num(b.paid)), total);
  const out = await db.tx(async t => {
    const n = await t.one('SELECT count(*)::int n FROM purchases WHERE tenant_id=$1', [req.tid]);
    const refNo = (type === 'return' ? 'PR-' : status === 'ordered' ? 'PO-' : 'GRN-') + String(n.n + 1).padStart(5, '0');
    const p = await t.one(`INSERT INTO purchases(tenant_id,branch_id,supplier_id,ref_no,invoice_no,date,status,type,subtotal,discount,total,paid,note,user_id,approved_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,$14) RETURNING *`,
      [req.tid, req.branchId, sup.id, refNo, str(b.invoice_no, 60), b.date || today(req), status, type, subtotal, discount, total, str(b.note, 500), req.user.id, c.can(req, 'accounting') || req.user.is_owner ? req.user.id : null]);
    for (const l of lines) await t.q('INSERT INTO purchase_items(tenant_id,purchase_id,ingredient_id,qty,unit_cost,total,batch,expiry) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [req.tid, p.id, l.ing, l.qty, l.cost, l.total, l.batch, l.expiry]);
    if (status === 'received') await receiveStock(t, req, p);
    if (paid > 0) {
      await t.q('INSERT INTO supplier_payments(tenant_id,supplier_id,purchase_id,amount,method,date,user_id,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [req.tid, sup.id, p.id, type === 'return' ? -paid : paid, str(b.method, 30) || 'Cash', b.date || today(req), req.user.id, type === 'return' ? 'Refund received' : null]);
      await t.q('UPDATE purchases SET paid=$2 WHERE id=$1', [p.id, paid]);
    }
    return p;
  });
  await c.audit(req, 'create', type, out.id, { total, status });
  res.json(out);
}));
r.post('/purchases/:id/receive', U('purchases'), wrap(async (req, res) => {
  await db.tx(async t => {
    const p = await t.one(`SELECT * FROM purchases WHERE id=$1 AND tenant_id=$2 AND status='ordered' FOR UPDATE`, [int(req.params.id), req.tid]);
    if (!p) fail(400, 'Purchase order is not waiting to be received');
    await receiveStock(t, req, p);
  });
  await c.audit(req, 'receive', 'purchase', int(req.params.id));
  res.json({ ok: true });
}));
r.post('/purchases/:id/approve', U(['accounting', 'settings']), wrap(async (req, res) => {
  await db.q('UPDATE purchases SET approved_by=$3 WHERE id=$1 AND tenant_id=$2', [int(req.params.id), req.tid, req.user.id]);
  await c.audit(req, 'approve', 'purchase', int(req.params.id)); res.json({ ok: true });
}));
r.delete('/purchases/:id', U('purchases'), wrap(async (req, res) => {
  const p = await db.one(`DELETE FROM purchases WHERE id=$1 AND tenant_id=$2 AND status='ordered' AND paid=0 RETURNING id`, [int(req.params.id), req.tid]);
  if (!p) fail(400, 'Only unpaid purchase orders that are not received can be deleted');
  await c.audit(req, 'delete', 'purchase', p.id); res.json({ ok: true });
}));
r.post('/purchases/:id/pay', U(['purchases', 'accounting']), wrap(async (req, res) => {
  const amt = num(req.body.amount);
  const p = await db.one('SELECT * FROM purchases WHERE id=$1 AND tenant_id=$2', [int(req.params.id), req.tid]);
  if (!p) fail(404, 'Not found');
  if (!(amt > 0) || amt > r2(num(p.total) - num(p.paid)) + 0.001) fail(400, `Amount must be between 0 and ${r2(num(p.total) - num(p.paid))}`);
  await db.q('INSERT INTO supplier_payments(tenant_id,supplier_id,purchase_id,amount,method,date,note,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [req.tid, p.supplier_id, p.id, amt, str(req.body.method, 30) || 'Cash', req.body.date || today(req), str(req.body.note, 300), req.user.id]);
  await db.q('UPDATE purchases SET paid=paid+$2 WHERE id=$1', [p.id, amt]);
  await c.audit(req, 'pay', 'purchase', p.id, { amount: amt });
  res.json({ ok: true });
}));
r.get('/suppliers/summary', U(['suppliers', 'purchases', 'accounting']), wrap(async (req, res) => {
  res.json(await db.all(`SELECT s.*,
      COALESCE((SELECT sum(total) FROM purchases p WHERE p.supplier_id=s.id AND p.type='purchase' AND p.status='received'),0) purchased,
      COALESCE((SELECT sum(total) FROM purchases p WHERE p.supplier_id=s.id AND p.type='return'),0) returned,
      COALESCE((SELECT sum(amount) FROM supplier_payments sp WHERE sp.supplier_id=s.id),0) paid
    FROM suppliers s WHERE s.tenant_id=$1 ORDER BY s.name`, [req.tid]).then(rows => rows.map(x => Object.assign(x, { balance: r2(num(x.purchased) - num(x.returned) - num(x.paid)) }))));
}));
r.get('/suppliers/:id/ledger', U(['suppliers', 'purchases', 'accounting']), wrap(async (req, res) => {
  const s = await db.one('SELECT * FROM suppliers WHERE id=$1 AND tenant_id=$2', [int(req.params.id), req.tid]);
  if (!s) fail(404, 'Not found');
  const rows = await db.all(`SELECT * FROM (
      SELECT date, created_at, CASE WHEN type='return' THEN 'Purchase return '||ref_no ELSE 'Purchase '||ref_no||COALESCE(' / Inv '||invoice_no,'') END particulars,
        CASE WHEN type='purchase' THEN total ELSE 0 END debit, CASE WHEN type='return' THEN total ELSE 0 END credit, id purchase_id
        FROM purchases WHERE supplier_id=$1 AND tenant_id=$2 AND (status='received' OR type='return')
      UNION ALL
      SELECT date, created_at, 'Payment ('||method||')'||COALESCE(' - '||note,''), 0, amount, purchase_id FROM supplier_payments WHERE supplier_id=$1 AND tenant_id=$2
    ) x ORDER BY date, created_at`, [s.id, req.tid]);
  let bal = 0; rows.forEach(x => { bal = r2(bal + num(x.debit) - num(x.credit)); x.balance = bal; });
  const items = await db.all(`SELECT i.name, i.unit, sum(pi.qty) qty, sum(pi.total) total, round(avg(pi.unit_cost)::numeric,4) avg_cost FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id JOIN ingredients i ON i.id=pi.ingredient_id
    WHERE p.supplier_id=$1 AND p.type='purchase' GROUP BY i.name, i.unit ORDER BY total DESC`, [s.id]);
  res.json({ supplier: s, ledger: rows, balance: bal, items });
}));
r.post('/suppliers/:id/pay', U(['purchases', 'accounting']), wrap(async (req, res) => {
  const amt = num(req.body.amount);
  if (!(amt > 0)) fail(400, 'Enter an amount');
  const s = await db.one('SELECT id FROM suppliers WHERE id=$1 AND tenant_id=$2', [int(req.params.id), req.tid]);
  if (!s) fail(404, 'Not found');
  await db.tx(async t => {
    // apply to oldest unpaid purchases first
    let left = amt;
    const open = await t.all(`SELECT id, total, paid FROM purchases WHERE supplier_id=$1 AND type='purchase' AND status='received' AND paid<total ORDER BY date, id`, [s.id]);
    for (const p of open) {
      if (left <= 0) break;
      const a = Math.min(left, r2(num(p.total) - num(p.paid)));
      await t.q('UPDATE purchases SET paid=paid+$2 WHERE id=$1', [p.id, a]);
      await t.q('INSERT INTO supplier_payments(tenant_id,supplier_id,purchase_id,amount,method,date,note,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [req.tid, s.id, p.id, a, str(req.body.method, 30) || 'Cash', req.body.date || today(req), str(req.body.note, 300), req.user.id]);
      left = r2(left - a);
    }
    if (left > 0) await t.q('INSERT INTO supplier_payments(tenant_id,supplier_id,amount,method,date,note,user_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [req.tid, s.id, left, str(req.body.method, 30) || 'Cash', req.body.date || today(req), str(req.body.note, 300) || 'Advance', req.user.id]);
  });
  await c.audit(req, 'pay', 'supplier', s.id, { amount: amt });
  res.json({ ok: true });
}));

// ================= accounting =================
async function pnl(req) {
  const p = [req.tid]; const b = br(req, 'branch_id', p); const d = dr(req, 'completed_at', p);
  const sales = await db.one(`SELECT count(*)::int orders, COALESCE(sum(subtotal),0) gross, COALESCE(sum(item_discount+discount),0) discounts, COALESCE(sum(vat),0) vat,
      COALESCE(sum(service_charge),0) service, COALESCE(sum(delivery_charge),0) delivery, COALESCE(sum(total),0) total, COALESCE(sum(cost),0) cogs
    FROM orders WHERE tenant_id=$1 AND status='completed' ${b} ${d}`, p);
  const { from, to } = rangeOf(req);
  const p2 = [req.tid, from, to]; const b2 = br(req, 'branch_id', p2);
  const refunds = await db.one(`SELECT COALESCE(sum(amount),0) s FROM refunds WHERE tenant_id=$1 AND (created_at AT TIME ZONE '${tz(req).replace(/'/g, '')}')::date BETWEEN $2 AND $3 ${b2}`, p2);
  const expenses = await db.all(`SELECT COALESCE(ec.name,'Uncategorised') category, sum(e.amount) amount FROM expenses e LEFT JOIN expense_categories ec ON ec.id=e.category_id
    WHERE e.tenant_id=$1 AND e.date BETWEEN $2 AND $3 ${b2.replace('branch_id', 'e.branch_id')} GROUP BY ec.name ORDER BY amount DESC`, p2);
  const p3 = [req.tid, from, to];
  const salary = await db.one(`SELECT COALESCE(sum(CASE WHEN type='deduction' THEN -amount WHEN type='advance' THEN 0 ELSE amount END),0) s FROM salary_payments WHERE tenant_id=$1 AND date BETWEEN $2 AND $3`, p3);
  const income = await db.one(`SELECT COALESCE(sum(amount),0) s FROM incomes WHERE tenant_id=$1 AND date BETWEEN $2 AND $3 ${b2}`, p2);
  const wasteP = [req.tid]; const wb = br(req, 'm.branch_id', wasteP) + dr(req, 'm.created_at', wasteP);
  const waste = await db.one(`SELECT COALESCE(sum(-m.qty * COALESCE(m.unit_cost, i.cost)),0) s FROM stock_moves m JOIN ingredients i ON i.id=m.ingredient_id WHERE m.tenant_id=$1 AND m.type IN ('waste','damage') ${wb}`, wasteP);
  const purchases = await db.one(`SELECT COALESCE(sum(total) FILTER (WHERE type='purchase'),0) - COALESCE(sum(total) FILTER (WHERE type='return'),0) s FROM purchases WHERE tenant_id=$1 AND status='received' AND date BETWEEN $2 AND $3 ${b2}`, p2);
  const netSales = r2(num(sales.total) - num(sales.vat) - num(refunds.s));
  const expTotal = r2(expenses.reduce((s, e) => s + num(e.amount), 0));
  const gross = r2(netSales - num(sales.cogs) - num(waste.s));
  const net = r2(gross + num(income.s) - expTotal - num(salary.s));
  return { from, to, sales, refunds: num(refunds.s), net_sales: netSales, cogs: num(sales.cogs), wastage: r2(num(waste.s)), gross_profit: gross,
    food_cost_pct: netSales > 0 ? r2((num(sales.cogs) + num(waste.s)) / netSales * 100) : 0, other_income: num(income.s), expenses, expense_total: expTotal,
    salary: num(salary.s), purchases: num(purchases.s), net_profit: net };
}
r.get('/accounting/summary', U(['accounting', 'reports']), wrap(async (req, res) => res.json(await pnl(req))));
r.get('/accounting/cashbook', U('accounting'), wrap(async (req, res) => {
  const { from, to } = rangeOf(req); const z = tz(req).replace(/'/g, '');
  const p = [req.tid, from, to]; const b = br(req, 'branch_id', p);
  const rows = await db.all(`SELECT * FROM (
    SELECT (created_at AT TIME ZONE '${z}')::date date, created_at, 'Sale #'||(SELECT order_no FROM orders o WHERE o.id=order_id) particulars, method, amount money_in, 0 money_out FROM order_payments WHERE tenant_id=$1 AND method<>'Due' ${b} AND (created_at AT TIME ZONE '${z}')::date BETWEEN $2 AND $3
    UNION ALL SELECT (created_at AT TIME ZONE '${z}')::date, created_at, 'Customer due received', method, amount, 0 FROM customer_payments WHERE tenant_id=$1 AND (created_at AT TIME ZONE '${z}')::date BETWEEN $2 AND $3
    UNION ALL SELECT date, created_at, 'Income: '||source, method, amount, 0 FROM incomes WHERE tenant_id=$1 ${b} AND date BETWEEN $2 AND $3
    UNION ALL SELECT (created_at AT TIME ZONE '${z}')::date, created_at, 'Refund order #'||(SELECT order_no FROM orders o WHERE o.id=order_id), method, 0, amount FROM refunds WHERE tenant_id=$1 ${b} AND (created_at AT TIME ZONE '${z}')::date BETWEEN $2 AND $3
    UNION ALL SELECT e.date, e.created_at, 'Expense: '||COALESCE((SELECT name FROM expense_categories c WHERE c.id=e.category_id),'')||COALESCE(' - '||e.note,''), e.method, 0, e.amount FROM expenses e WHERE e.tenant_id=$1 ${b.replace('branch_id', 'e.branch_id')} AND e.date BETWEEN $2 AND $3
    UNION ALL SELECT sp.date, sp.created_at, 'Supplier payment: '||COALESCE((SELECT name FROM suppliers s WHERE s.id=sp.supplier_id),''), sp.method, CASE WHEN sp.amount<0 THEN -sp.amount ELSE 0 END, CASE WHEN sp.amount>0 THEN sp.amount ELSE 0 END FROM supplier_payments sp WHERE sp.tenant_id=$1 AND sp.date BETWEEN $2 AND $3
    UNION ALL SELECT date, created_at, 'Salary/'||type||': '||COALESCE((SELECT name FROM users u WHERE u.id=user_id),''), method, CASE WHEN type='deduction' THEN amount ELSE 0 END, CASE WHEN type<>'deduction' THEN amount ELSE 0 END FROM salary_payments WHERE tenant_id=$1 AND date BETWEEN $2 AND $3
    UNION ALL SELECT (created_at AT TIME ZONE '${z}')::date, created_at, 'Drawer cash '||type||COALESCE(' - '||note,''), 'Cash', CASE WHEN type='in' THEN amount ELSE 0 END, CASE WHEN type='out' THEN amount ELSE 0 END FROM cash_moves WHERE tenant_id=$1 ${b} AND (created_at AT TIME ZONE '${z}')::date BETWEEN $2 AND $3
  ) x ORDER BY date, created_at`, p);
  let bal = 0; rows.forEach(x => { bal = r2(bal + num(x.money_in) - num(x.money_out)); x.balance = bal; });
  const byMethod = {};
  rows.forEach(x => { const m = x.method || 'Other'; byMethod[m] = byMethod[m] || { in: 0, out: 0 }; byMethod[m].in = r2(byMethod[m].in + num(x.money_in)); byMethod[m].out = r2(byMethod[m].out + num(x.money_out)); });
  res.json({ from, to, rows, total_in: r2(rows.reduce((s, x) => s + num(x.money_in), 0)), total_out: r2(rows.reduce((s, x) => s + num(x.money_out), 0)), by_method: byMethod });
}));
r.get('/accounting/vat', U(['accounting', 'reports']), wrap(async (req, res) => {
  const p = [req.tid]; const w = br(req, 'branch_id', p) + dr(req, 'completed_at', p);
  const rows = await db.all(`SELECT (completed_at AT TIME ZONE $${p.length - 2})::date date, count(*)::int invoices, sum(subtotal - item_discount - discount) taxable, sum(service_charge) service, sum(vat) vat, sum(total) total
    FROM orders WHERE tenant_id=$1 AND status='completed' ${w} GROUP BY 1 ORDER BY 1`, p);
  res.json({ rows, vat_pct: req.tenant.settings.vat_pct, inclusive: req.tenant.settings.vat_inclusive, bin: req.tenant.settings.bin, total_vat: r2(rows.reduce((s, x) => s + num(x.vat), 0)) });
}));
r.get('/accounting/dues', U(['accounting', 'customers', 'suppliers']), wrap(async (req, res) => {
  const customers = await db.all('SELECT id, name, phone, due, credit_limit, last_visit FROM customers WHERE tenant_id=$1 AND due>0 ORDER BY due DESC', [req.tid]);
  const suppliers = await db.all(`SELECT s.id, s.name, s.phone, sum(p.total - p.paid) due, min(p.date) oldest FROM purchases p JOIN suppliers s ON s.id=p.supplier_id
    WHERE p.tenant_id=$1 AND p.type='purchase' AND p.status='received' AND p.paid<p.total GROUP BY s.id ORDER BY due DESC`, [req.tid]);
  res.json({ customers, suppliers, receivable: r2(customers.reduce((s, x) => s + num(x.due), 0)), payable: r2(suppliers.reduce((s, x) => s + num(x.due), 0)) });
}));
r.get('/accounting/balance', U('accounting'), wrap(async (req, res) => {
  const accounts = await db.all(`SELECT a.*,
      COALESCE((SELECT sum(amount) FROM incomes i WHERE i.account_id=a.id),0) income,
      COALESCE((SELECT sum(amount) FROM expenses e WHERE e.account_id=a.id),0) expense,
      COALESCE((SELECT sum(debit - credit) FROM journals j WHERE j.account_id=a.id),0) journal
    FROM accounts a WHERE a.tenant_id=$1 ORDER BY a.id`, [req.tid]);
  accounts.forEach(a => { a.balance = r2(num(a.opening_balance) + num(a.income) - num(a.expense) + num(a.journal)); });
  const sales = await db.all(`SELECT method, sum(amount) amount FROM order_payments WHERE tenant_id=$1 AND method<>'Due' GROUP BY method`, [req.tid]);
  const refunds = await db.all(`SELECT method, sum(amount) amount FROM refunds WHERE tenant_id=$1 GROUP BY method`, [req.tid]);
  const stock = await db.one('SELECT COALESCE(sum(GREATEST(s.qty,0) * i.cost),0) v FROM stock s JOIN ingredients i ON i.id=s.ingredient_id WHERE s.tenant_id=$1', [req.tid]);
  const recv = await db.one('SELECT COALESCE(sum(due),0) v FROM customers WHERE tenant_id=$1', [req.tid]);
  const pay = await db.one(`SELECT COALESCE(sum(total-paid),0) v FROM purchases WHERE tenant_id=$1 AND type='purchase' AND status='received'`, [req.tid]);
  const methodIn = {}; sales.forEach(s => { methodIn[s.method] = num(s.amount); }); refunds.forEach(s => { methodIn[s.method] = (methodIn[s.method] || 0) - num(s.amount); });
  res.json({ accounts, collected_by_method: methodIn, assets: { stock_value: r2(stock.v), receivables: r2(recv.v) }, liabilities: { payables: r2(pay.v) } });
}));
r.post('/accounting/close-period', U('accounting'), wrap(async (req, res) => {
  const summary = await pnl(req);
  const row = await db.one('INSERT INTO period_closings(tenant_id,period,from_date,to_date,summary,user_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [req.tid, str(req.body.period, 60) || `${summary.from} to ${summary.to}`, summary.from, summary.to, JSON.stringify(summary), req.user.id]);
  await c.audit(req, 'close', 'period', row.id, { from: summary.from, to: summary.to });
  res.json(row);
}));
r.get('/accounting/closings', U('accounting'), wrap(async (req, res) => {
  res.json(await db.all('SELECT p.*, u.name user_name FROM period_closings p LEFT JOIN users u ON u.id=p.user_id WHERE p.tenant_id=$1 ORDER BY id DESC', [req.tid]));
}));

// ================= dashboard =================
r.get('/dashboard', U(null), wrap(async (req, res) => {
  const z = tz(req), t = today(req);
  const p = [req.tid, z, t]; const b = br(req, 'branch_id', p);
  const kpi = await db.one(`SELECT
      COALESCE(sum(total) FILTER (WHERE (completed_at AT TIME ZONE $2)::date = $3::date),0) sales_today,
      count(*) FILTER (WHERE (completed_at AT TIME ZONE $2)::date = $3::date)::int orders_today,
      COALESCE(sum(total) FILTER (WHERE (completed_at AT TIME ZONE $2)::date = $3::date - 1),0) sales_yesterday,
      COALESCE(sum(total) FILTER (WHERE (completed_at AT TIME ZONE $2)::date > $3::date - 7),0) sales_7d,
      COALESCE(sum(total) FILTER (WHERE date_trunc('month', completed_at AT TIME ZONE $2) = date_trunc('month', $3::date)),0) sales_month,
      COALESCE(sum(cost) FILTER (WHERE (completed_at AT TIME ZONE $2)::date = $3::date),0) cost_today
    FROM orders WHERE tenant_id=$1 AND status='completed' AND completed_at > now() - interval '40 days' ${b}`, p);
  const p2 = [req.tid]; const b2 = br(req, 'branch_id', p2);
  const live = await db.one(`SELECT count(*) FILTER (WHERE status IN ('open','held'))::int open_orders, count(*) FILTER (WHERE status='pending')::int pending_online,
      COALESCE(sum(total) FILTER (WHERE status IN ('open','held')),0) open_value FROM orders WHERE tenant_id=$1 ${b2}`, p2);
  const p3 = [req.tid, z]; const b3 = br(req, 'branch_id', p3);
  const trend = await db.all(`SELECT to_char(d,'YYYY-MM-DD') AS day, COALESCE((SELECT sum(total) FROM orders WHERE tenant_id=$1 AND status='completed' ${b3} AND (completed_at AT TIME ZONE $2)::date = d::date),0) total
    FROM generate_series((now() AT TIME ZONE $2)::date - 13, (now() AT TIME ZONE $2)::date, interval '1 day') d`, p3);
  const p4 = [req.tid, z, t]; const b4 = br(req, 'o.branch_id', p4);
  const top = await db.all(`SELECT i.name, sum(i.qty) qty, sum(i.total) total FROM order_items i JOIN orders o ON o.id=i.order_id
    WHERE o.tenant_id=$1 AND o.status='completed' AND i.kstatus<>'cancelled' AND (o.completed_at AT TIME ZONE $2)::date > $3::date - 7 ${b4} GROUP BY i.name ORDER BY qty DESC LIMIT 6`, p4);
  const p5 = [req.tid, z, t]; const b5 = br(req, 'branch_id', p5);
  const methods = await db.all(`SELECT method, sum(amount) amount FROM order_payments WHERE tenant_id=$1 AND (created_at AT TIME ZONE $2)::date=$3::date ${b5} GROUP BY method ORDER BY amount DESC`, p5);
  const p6 = [req.tid, z, t]; const b6 = br(req, 'branch_id', p6);
  const hourly = await db.all(`SELECT extract(hour from completed_at AT TIME ZONE $2)::int h, sum(total) total, count(*)::int n FROM orders WHERE tenant_id=$1 AND status='completed' AND (completed_at AT TIME ZONE $2)::date=$3::date ${b6} GROUP BY 1 ORDER BY 1`, p6);
  const lowStock = await db.all(`SELECT i.name, i.unit, i.min_stock, COALESCE(s.qty,0) qty FROM ingredients i LEFT JOIN stock s ON s.ingredient_id=i.id AND s.branch_id=$2
    WHERE i.tenant_id=$1 AND i.active AND i.min_stock>0 AND COALESCE(s.qty,0) <= i.min_stock ORDER BY i.name LIMIT 10`, [req.tid, req.branchId]);
  const reservations = await db.all(`SELECT r.customer_name, r.time, r.guests, r.status, t.name table_name FROM reservations r LEFT JOIN tables t ON t.id=r.table_id
    WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.date=$3 AND r.status IN ('booked','confirmed','waitlist') ORDER BY r.time LIMIT 8`, [req.tid, req.branchId, t]);
  const birthdays = await db.all(`SELECT name, phone FROM customers WHERE tenant_id=$1 AND ((birthday IS NOT NULL AND to_char(birthday,'MM-DD')=to_char($2::date,'MM-DD')) OR (anniversary IS NOT NULL AND to_char(anniversary,'MM-DD')=to_char($2::date,'MM-DD'))) LIMIT 10`, [req.tid, t]);
  const dues = await db.one(`SELECT (SELECT COALESCE(sum(due),0) FROM customers WHERE tenant_id=$1) receivable,
    (SELECT COALESCE(sum(total-paid),0) FROM purchases WHERE tenant_id=$1 AND type='purchase' AND status='received') payable`, [req.tid]);
  res.json({ today: t, kpi, live, trend, top, methods, hourly, low_stock: lowStock, reservations, birthdays, dues });
}));

// ================= reports =================
const REPORTS = {
  async sales(req) {
    const p = [req.tid]; const w = br(req, 'branch_id', p) + dr(req, 'completed_at', p);
    return db.all(`SELECT (completed_at AT TIME ZONE $${p.length - 2})::date date, count(*)::int orders, sum(subtotal) gross, sum(item_discount+discount) discount, sum(service_charge) service,
      sum(vat) vat, sum(delivery_charge) delivery, sum(total) total, sum(cost) cost, sum(total - vat - cost) gross_profit, round(avg(total)::numeric,2) avg_ticket, sum(refunded) refunded
      FROM orders WHERE tenant_id=$1 AND status='completed' ${w} GROUP BY 1 ORDER BY 1`, p);
  },
  async monthly(req) {
    const p = [req.tid, tz(req)]; const w = br(req, 'branch_id', p);
    return db.all(`SELECT to_char(completed_at AT TIME ZONE $2,'YYYY-MM') AS month, count(*)::int orders, sum(total) total, sum(vat) vat, sum(cost) cost, round(avg(total)::numeric,2) avg_ticket
      FROM orders WHERE tenant_id=$1 AND status='completed' AND completed_at > now() - interval '2 years' ${w} GROUP BY 1 ORDER BY 1 DESC`, p);
  },
  async products(req) {
    const p = [req.tid]; const w = br(req, 'o.branch_id', p) + dr(req, 'o.completed_at', p);
    return db.all(`SELECT i.name, COALESCE(c.name,'—') category, sum(i.qty) qty, sum(i.total) revenue, sum(i.cost) cost, sum(i.total - i.cost) profit,
      CASE WHEN sum(i.total)>0 THEN round((sum(i.cost)/sum(i.total)*100)::numeric,1) ELSE 0 END food_cost_pct
      FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN products pr ON pr.id=i.product_id LEFT JOIN categories c ON c.id=pr.category_id
      WHERE o.tenant_id=$1 AND o.status='completed' AND i.kstatus<>'cancelled' ${w} GROUP BY i.name, c.name ORDER BY qty DESC`, p);
  },
  async categories(req) {
    const p = [req.tid]; const w = br(req, 'o.branch_id', p) + dr(req, 'o.completed_at', p);
    return db.all(`SELECT COALESCE(c.name,'Other') category, sum(i.qty) qty, sum(i.total) revenue, sum(i.cost) cost, sum(i.total-i.cost) profit
      FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN products pr ON pr.id=i.product_id LEFT JOIN categories c ON c.id=pr.category_id
      WHERE o.tenant_id=$1 AND o.status='completed' AND i.kstatus<>'cancelled' ${w} GROUP BY 1 ORDER BY revenue DESC`, p);
  },
  async hourly(req) {
    const p = [req.tid]; const w = br(req, 'branch_id', p) + dr(req, 'completed_at', p);
    return db.all(`SELECT lpad(extract(hour from completed_at AT TIME ZONE $${p.length - 2})::text,2,'0')||':00' AS hour, count(*)::int orders, sum(total) total, round(avg(total)::numeric,2) avg_ticket
      FROM orders WHERE tenant_id=$1 AND status='completed' ${w} GROUP BY 1 ORDER BY 1`, p);
  },
  async weekday(req) {
    const p = [req.tid]; const w = br(req, 'branch_id', p) + dr(req, 'completed_at', p);
    return db.all(`SELECT to_char(completed_at AT TIME ZONE $${p.length - 2},'ID Day') weekday, count(*)::int orders, sum(total) total, round(avg(total)::numeric,2) avg_ticket
      FROM orders WHERE tenant_id=$1 AND status='completed' ${w} GROUP BY 1 ORDER BY 1`, p);
  },
  async types(req) {
    const p = [req.tid]; const w = br(req, 'branch_id', p) + dr(req, 'completed_at', p);
    return db.all(`SELECT type order_type, source, count(*)::int orders, sum(total) total, round(avg(total)::numeric,2) avg_ticket FROM orders WHERE tenant_id=$1 AND status='completed' ${w} GROUP BY 1,2 ORDER BY total DESC`, p);
  },
  async payments(req) {
    const p = [req.tid]; const w = br(req, 'p.branch_id', p) + dr(req, 'p.created_at', p);
    return db.all(`SELECT method, count(*)::int payments, sum(amount) amount FROM order_payments p WHERE p.tenant_id=$1 ${w} GROUP BY method ORDER BY amount DESC`, p);
  },
  async waiters(req) {
    const p = [req.tid]; const w = br(req, 'o.branch_id', p) + dr(req, 'o.completed_at', p);
    return db.all(`SELECT COALESCE(u.name,'(none)') waiter, count(*)::int orders, sum(o.total) total, round(avg(o.total)::numeric,2) avg_ticket, sum(o.guests) guests
      FROM orders o LEFT JOIN users u ON u.id=o.waiter_id WHERE o.tenant_id=$1 AND o.status='completed' ${w} GROUP BY u.name ORDER BY total DESC`, p);
  },
  async cashiers(req) {
    const p = [req.tid]; const w = br(req, 'o.branch_id', p) + dr(req, 'o.completed_at', p);
    return db.all(`SELECT COALESCE(u.name,'(online)') cashier, count(*)::int orders, sum(o.total) total, sum(o.item_discount+o.discount) discounts
      FROM orders o LEFT JOIN users u ON u.id=o.cashier_id WHERE o.tenant_id=$1 AND o.status='completed' ${w} GROUP BY u.name ORDER BY total DESC`, p);
  },
  async branches(req) {
    const p = [req.tid]; const w = dr(req, 'o.completed_at', p);
    return db.all(`SELECT b.name branch, count(o.id)::int orders, COALESCE(sum(o.total),0) total, COALESCE(sum(o.cost),0) cost, COALESCE(sum(o.total-o.vat-o.cost),0) gross_profit, round(COALESCE(avg(o.total),0)::numeric,2) avg_ticket
      FROM branches b LEFT JOIN orders o ON o.branch_id=b.id AND o.status='completed' ${w} WHERE b.tenant_id=$1 GROUP BY b.id ORDER BY total DESC`, p);
  },
  async tables(req) {
    const p = [req.tid]; const w = br(req, 'o.branch_id', p) + dr(req, 'o.completed_at', p);
    return db.all(`SELECT t.name table_name, count(o.id)::int orders, sum(o.total) total, sum(o.guests) guests,
      round(avg(EXTRACT(EPOCH FROM (o.completed_at - o.created_at))/60)::numeric,0) avg_minutes
      FROM orders o JOIN tables t ON t.id=o.table_id WHERE o.tenant_id=$1 AND o.status='completed' ${w} GROUP BY t.name ORDER BY total DESC`, p);
  },
  async kitchen(req) {
    const p = [req.tid]; const w = br(req, 'o.branch_id', p) + dr(req, 'i.sent_at', p);
    const delay = num(req.tenant.settings.kds_delay_min, 15);
    return db.all(`SELECT COALESCE(s.name,'(no station)') station, count(*)::int items,
      round(avg(EXTRACT(EPOCH FROM (i.ready_at - i.sent_at))/60)::numeric,1) avg_prep_min,
      round(max(EXTRACT(EPOCH FROM (i.ready_at - i.sent_at))/60)::numeric,1) max_prep_min,
      count(*) FILTER (WHERE EXTRACT(EPOCH FROM (i.ready_at - i.sent_at))/60 > ${delay})::int delayed,
      count(*) FILTER (WHERE i.kstatus='cancelled')::int cancelled
      FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN stations s ON s.id=i.station_id WHERE i.tenant_id=$1 AND i.sent_at IS NOT NULL ${w} GROUP BY s.name ORDER BY items DESC`, p);
  },
  async cancellations(req) {
    const p = [req.tid]; const w = br(req, 'o.branch_id', p) + dr(req, 'o.created_at', p);
    return db.all(`SELECT o.order_no, o.status, o.type, o.total, o.cancel_reason reason, o.cancelled_at, u.name cashier,
      (SELECT string_agg(i.name||' x'||i.qty, ', ') FROM order_items i WHERE i.order_id=o.id) items
      FROM orders o LEFT JOIN users u ON u.id=o.cashier_id WHERE o.tenant_id=$1 AND o.status IN ('cancelled','rejected') ${w} ORDER BY o.id DESC`, p);
  },
  async refunds(req) {
    const p = [req.tid]; const w = br(req, 'f.branch_id', p) + dr(req, 'f.created_at', p);
    return db.all(`SELECT o.order_no, f.amount, f.method, f.reason, f.restock, f.created_at, u.name by_user, a.name approved_by
      FROM refunds f JOIN orders o ON o.id=f.order_id LEFT JOIN users u ON u.id=f.user_id LEFT JOIN users a ON a.id=f.approved_by WHERE f.tenant_id=$1 ${w} ORDER BY f.id DESC`, p);
  },
  async discounts(req) {
    const p = [req.tid]; const w = br(req, 'o.branch_id', p) + dr(req, 'o.completed_at', p);
    return db.all(`SELECT o.order_no, o.completed_at, o.subtotal, o.item_discount, o.discount, o.coupon_code, o.points_redeemed, u.name cashier, o.total
      FROM orders o LEFT JOIN users u ON u.id=o.cashier_id WHERE o.tenant_id=$1 AND o.status='completed' AND (o.discount>0 OR o.item_discount>0) ${w} ORDER BY o.id DESC`, p);
  },
  async wastage(req) {
    const p = [req.tid]; const w = br(req, 'm.branch_id', p) + dr(req, 'm.created_at', p);
    return db.all(`SELECT i.name, i.unit, m.type, sum(-m.qty) qty, round(sum(-m.qty * COALESCE(m.unit_cost, i.cost))::numeric,2) value, string_agg(DISTINCT m.note, '; ') notes
      FROM stock_moves m JOIN ingredients i ON i.id=m.ingredient_id WHERE m.tenant_id=$1 AND m.type IN ('waste','damage','staff_meal') ${w} GROUP BY i.name, i.unit, m.type ORDER BY value DESC`, p);
  },
  async stock_movement(req) {
    const p = [req.tid]; const w = br(req, 'm.branch_id', p) + dr(req, 'm.created_at', p);
    return db.all(`SELECT i.name, i.unit, sum(m.qty) FILTER (WHERE m.qty>0) qty_in, -sum(m.qty) FILTER (WHERE m.qty<0) qty_out,
      sum(m.qty) FILTER (WHERE m.type='purchase') purchased, -sum(m.qty) FILTER (WHERE m.type='sale') used_in_sales, -sum(m.qty) FILTER (WHERE m.type IN ('waste','damage')) wasted
      FROM stock_moves m JOIN ingredients i ON i.id=m.ingredient_id WHERE m.tenant_id=$1 ${w} GROUP BY i.name, i.unit ORDER BY i.name`, p);
  },
  async low_stock(req) {
    return db.all(`SELECT i.name, i.unit, i.min_stock, COALESCE(s.qty,0) qty, i.cost FROM ingredients i LEFT JOIN stock s ON s.ingredient_id=i.id AND s.branch_id=$2
      WHERE i.tenant_id=$1 AND i.active AND i.min_stock>0 AND COALESCE(s.qty,0) <= i.min_stock ORDER BY i.name`, [req.tid, req.branchId]);
  },
  async staff(req) {
    const { from, to } = rangeOf(req); const z = tz(req);
    return db.all(`SELECT u.name, r.name role,
      (SELECT count(*)::int FROM orders o WHERE (o.waiter_id=u.id OR o.cashier_id=u.id) AND o.status='completed' AND (o.completed_at AT TIME ZONE $4)::date BETWEEN $2 AND $3) orders,
      (SELECT COALESCE(sum(total),0) FROM orders o WHERE (o.waiter_id=u.id OR o.cashier_id=u.id) AND o.status='completed' AND (o.completed_at AT TIME ZONE $4)::date BETWEEN $2 AND $3) sales,
      (SELECT count(*)::int FROM attendance a WHERE a.user_id=u.id AND a.date BETWEEN $2 AND $3) days_present,
      (SELECT round(COALESCE(sum(EXTRACT(EPOCH FROM (a.clock_out-a.clock_in))/3600),0)::numeric,1) FROM attendance a WHERE a.user_id=u.id AND a.date BETWEEN $2 AND $3) hours,
      (SELECT count(*)::int FROM audit_logs l WHERE l.user_id=u.id AND (l.created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3) actions,
      (SELECT count(*)::int FROM refunds f WHERE f.user_id=u.id AND (f.created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3) refunds
      FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.tenant_id=$1 ORDER BY sales DESC`, [req.tid, from, to, z]);
  },
  async customers(req) {
    const p = [req.tid]; const w = br(req, 'o.branch_id', p) + dr(req, 'o.completed_at', p);
    return db.all(`SELECT cu.name, cu.phone, count(o.id)::int orders, sum(o.total) spent, cu.visits lifetime_visits, cu.total_spent lifetime_spent, cu.points, cu.due,
      CASE WHEN cu.visits >= 10 THEN 'Loyal' WHEN cu.visits >= 3 THEN 'Regular' ELSE 'New' END segment
      FROM orders o JOIN customers cu ON cu.id=o.customer_id WHERE o.tenant_id=$1 AND o.status='completed' ${w} GROUP BY cu.id ORDER BY spent DESC LIMIT 200`, p);
  },
  async retention(req) {
    const z = tz(req);
    return db.all(`WITH f AS (SELECT customer_id, min(completed_at) first_at FROM orders WHERE tenant_id=$1 AND status='completed' AND customer_id IS NOT NULL GROUP BY customer_id)
      SELECT to_char(o.completed_at AT TIME ZONE $2,'YYYY-MM') AS month, count(DISTINCT o.customer_id)::int customers,
        count(DISTINCT o.customer_id) FILTER (WHERE date_trunc('month', f.first_at) = date_trunc('month', o.completed_at))::int new_customers,
        count(DISTINCT o.customer_id) FILTER (WHERE date_trunc('month', f.first_at) < date_trunc('month', o.completed_at))::int returning_customers
      FROM orders o JOIN f ON f.customer_id=o.customer_id WHERE o.tenant_id=$1 AND o.status='completed' AND o.completed_at > now() - interval '12 months' GROUP BY 1 ORDER BY 1 DESC`, [req.tid, z]);
  },
  async menu_engineering(req) {
    const rows = await REPORTS.products(req);
    if (!rows.length) return rows;
    const avgQty = rows.reduce((s, x) => s + num(x.qty), 0) / rows.length;
    const margins = rows.map(x => num(x.qty) > 0 ? num(x.profit) / num(x.qty) : 0);
    const avgM = margins.reduce((s, x) => s + x, 0) / rows.length;
    return rows.map((x, i) => {
      const pop = num(x.qty) >= avgQty, prof = margins[i] >= avgM;
      return { name: x.name, category: x.category, qty: x.qty, revenue: x.revenue, profit_per_item: r2(margins[i]), class: pop && prof ? '⭐ Star (keep & promote)' : pop ? '🐴 Plowhorse (popular, raise price/cut cost)' : prof ? '❓ Puzzle (profitable, promote more)' : '🐶 Dog (consider removing)' };
    });
  },
  async forecast(req) {
    // average of the same weekday over the last 8 weeks → next 7 days
    const p = [req.tid, tz(req)]; const w = br(req, 'branch_id', p);
    const hist = await db.all(`SELECT extract(isodow from completed_at AT TIME ZONE $2)::int dow, (completed_at AT TIME ZONE $2)::date d, sum(total) total, count(*)::int orders
      FROM orders WHERE tenant_id=$1 AND status='completed' AND completed_at > now() - interval '56 days' ${w} GROUP BY 1,2`, p);
    const out = [];
    const base = new Date(today(req) + 'T00:00:00Z');
    for (let i = 1; i <= 7; i++) {
      const d = new Date(base.getTime() + i * 86400000);
      const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
      const same = hist.filter(h => h.dow === dow);
      const avg = same.length ? same.reduce((s, h) => s + num(h.total), 0) / same.length : 0;
      const avgO = same.length ? same.reduce((s, h) => s + num(h.orders), 0) / same.length : 0;
      out.push({ date: d.toISOString().slice(0, 10), weekday: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }), expected_sales: r2(avg), expected_orders: Math.round(avgO), based_on_days: same.length });
    }
    return out;
  },
  async delivery(req) {
    const p = [req.tid]; const w = br(req, 'o.branch_id', p) + dr(req, 'o.created_at', p);
    return db.all(`SELECT COALESCE(z.name,'(no zone)') zone, count(*)::int orders, count(*) FILTER (WHERE o.delivery_status='delivered')::int delivered, count(*) FILTER (WHERE o.delivery_status='failed')::int failed,
      sum(o.delivery_charge) delivery_charges, sum(o.total) total FROM orders o LEFT JOIN zones z ON z.id=o.zone_id WHERE o.tenant_id=$1 AND o.type='delivery' AND o.status NOT IN ('cancelled','rejected','merged') ${w} GROUP BY z.name ORDER BY orders DESC`, p);
  },
  async expenses(req) {
    const { from, to } = rangeOf(req); const p = [req.tid, from, to]; const w = br(req, 'e.branch_id', p);
    return db.all(`SELECT e.date, COALESCE(c.name,'—') category, e.amount, e.method, e.note, u.name by_user FROM expenses e LEFT JOIN expense_categories c ON c.id=e.category_id LEFT JOIN users u ON u.id=e.user_id
      WHERE e.tenant_id=$1 AND e.date BETWEEN $2 AND $3 ${w} ORDER BY e.date DESC`, p);
  },
  async purchases(req) {
    const { from, to } = rangeOf(req);
    return db.all(`SELECT s.name supplier, count(p.id)::int purchases, sum(p.total) FILTER (WHERE p.type='purchase') total, sum(p.total) FILTER (WHERE p.type='return') returns, sum(p.paid) paid, sum(p.total-p.paid) FILTER (WHERE p.type='purchase') due
      FROM purchases p JOIN suppliers s ON s.id=p.supplier_id WHERE p.tenant_id=$1 AND p.date BETWEEN $2 AND $3 AND p.status='received' GROUP BY s.name ORDER BY total DESC NULLS LAST`, [req.tid, from, to]);
  }
};
r.get('/reports/:kind', U('reports'), wrap(async (req, res) => {
  const fn = REPORTS[req.params.kind];
  if (!fn) fail(404, 'Unknown report');
  const { from, to } = rangeOf(req);
  res.json({ kind: req.params.kind, from, to, rows: await fn(req) });
}));

module.exports = r;
