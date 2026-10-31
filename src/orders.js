// Order engine: pricing, totals, create/update, payment, completion (stock deduction, loyalty), void, refund, split, merge
const c = require('./core');
const { r2, num, int, str, fail } = c;

function localNow(tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const g = k => (parts.find(p => p.type === k) || {}).value;
  const hh = g('hour') === '24' ? '00' : g('hour');
  return { date: `${g('year')}-${g('month')}-${g('day')}`, hm: `${hh}:${g('minute')}` };
}
function inWindow(from, to, hm) {
  if (!from || !to) return true;
  return from <= to ? hm >= from && hm <= to : hm >= from || hm <= to; // supports overnight windows
}
function effectivePrice(p, branchId, now) {
  let price = num(p.price);
  if (p.sched_price != null && p.sched_from && now.date >= p.sched_from) price = num(p.sched_price);
  const bp = p.branch_prices && p.branch_prices[String(branchId)];
  if (bp !== undefined && bp !== null && bp !== '') price = num(bp);
  if (p.happy_price != null && p.happy_from && p.happy_to && inWindow(p.happy_from, p.happy_to, now.hm)) price = num(p.happy_price);
  return price;
}
function productVisible(p, branchId, now) {
  if (!p.active || !p.available) return false;
  const b = p.branch_ids || [];
  if (b.length && !b.map(String).includes(String(branchId))) return false;
  if (p.avail_from && p.avail_to && !inWindow(p.avail_from, p.avail_to, now.hm)) return false;
  return true;
}

// Turn client items into priced rows (prices always come from the DB)
async function buildItems(t, ctx, input, allowCustom) {
  const ids = [...new Set((input || []).map(i => int(i.product_id)).filter(Boolean))];
  const prods = ids.length ? await t.all(`SELECT p.*, cat.station_id cat_station FROM products p LEFT JOIN categories cat ON cat.id=p.category_id WHERE p.tenant_id=$1 AND p.id = ANY($2::int[])`, [ctx.tid, ids]) : [];
  const map = new Map(prods.map(p => [p.id, p]));
  const now = localNow(ctx.settings.timezone);
  const out = [];
  for (const i of input || []) {
    let qty = num(i.qty, 1);
    if (!(qty > 0)) continue;
    if (!i.product_id) {
      if (!allowCustom || !i.name) continue;
      const price = Math.max(0, num(i.price));
      out.push({ id: int(i.id), product_id: null, name: str(i.name, 120), variant: null, addons: [], qty, unit_price: r2(price), discount: r2(Math.max(0, num(i.discount))), note: str(i.note, 300), station_id: null, tax_exempt: false });
      continue;
    }
    const p = map.get(int(i.product_id));
    if (!p) fail(400, 'A product in the order no longer exists');
    if (!allowCustom && !productVisible(p, ctx.branchId, now)) fail(400, `"${p.name}" is not available right now`);
    if (!p.by_weight) qty = Math.max(1, Math.round(qty));
    let price = effectivePrice(p, ctx.branchId, now), variant = null;
    if (i.variant) {
      const v = (p.variants || []).find(v => v.name === i.variant);
      if (!v) fail(400, `Option "${i.variant}" not found for ${p.name}`);
      variant = v.name; price = num(v.price);
    }
    const addons = [];
    for (const a of [].concat(i.addons || [])) {
      const name = typeof a === 'string' ? a : a && a.name;
      const found = (p.addons || []).find(x => x.name === name);
      if (found) { addons.push({ name: found.name, price: num(found.price) }); price += num(found.price); }
    }
    let disc = Math.max(0, num(i.discount));
    if (disc > price * qty) disc = price * qty;
    out.push({ id: int(i.id), product_id: p.id, name: p.name, variant, addons, qty, unit_price: r2(price), discount: r2(disc), note: str(i.note, 300), station_id: p.station_id || p.cat_station || null, tax_exempt: !!p.tax_exempt });
  }
  return out;
}

async function findCoupon(t, tid, code, lineNet, customerId, items) {
  if (!code) return null;
  const cp = await t.one(`SELECT * FROM coupons WHERE tenant_id=$1 AND upper(code)=upper($2) AND active`, [tid, String(code).trim()]);
  if (!cp) fail(400, 'Coupon code is not valid');
  const today = new Date().toISOString().slice(0, 10);
  if (cp.starts && today < cp.starts) fail(400, 'Coupon is not active yet');
  if (cp.ends && today > cp.ends) fail(400, 'Coupon has expired');
  if (cp.max_uses > 0 && cp.used >= cp.max_uses) fail(400, 'Coupon usage limit reached');
  if (num(cp.min_order) > 0 && lineNet < num(cp.min_order)) fail(400, `Coupon needs a minimum order of ${cp.min_order}`);
  if (cp.first_order_only) {
    if (!customerId) fail(400, 'This coupon is for first orders — add the customer first');
    const n = await t.one(`SELECT count(*)::int n FROM orders WHERE tenant_id=$1 AND customer_id=$2 AND status='completed'`, [tid, customerId]);
    if (n.n > 0) fail(400, 'Coupon is only for the first order');
  }
  let d = 0;
  if (cp.type === 'percent') d = lineNet * num(cp.value) / 100;
  else if (cp.type === 'fixed') d = num(cp.value);
  else if (cp.type === 'bogo') {
    const rows = items.filter(i => i.product_id === cp.bogo_product_id && i.kstatus !== 'cancelled');
    const qty = rows.reduce((s, i) => s + num(i.qty), 0);
    if (!rows.length || qty < 2) fail(400, 'Buy-one-get-one needs 2 of the offer item in the cart');
    d = Math.floor(qty / 2) * Math.min(...rows.map(i => num(i.unit_price)));
  }
  if (num(cp.max_discount) > 0) d = Math.min(d, num(cp.max_discount));
  return { coupon: cp, amount: r2(d) };
}

function computeTotals(items, o, settings, extra) {
  const active = items.filter(i => i.kstatus !== 'cancelled');
  const subtotal = active.reduce((s, i) => s + num(i.unit_price) * num(i.qty), 0);
  const itemDisc = active.reduce((s, i) => s + num(i.discount), 0);
  const lineNet = subtotal - itemDisc;
  const taxable = active.filter(i => !i.tax_exempt).reduce((s, i) => s + num(i.unit_price) * num(i.qty) - num(i.discount), 0);
  let disc = 0;
  if (o.discount_type === 'percent') disc = lineNet * Math.min(100, num(o.discount_value)) / 100;
  else if (o.discount_type === 'fixed') disc = num(o.discount_value);
  disc += num(extra.coupon) + num(extra.points);
  disc = Math.min(Math.max(0, disc), lineNet);
  const net = lineNet - disc;
  const svc = (!settings.service_dine_in_only || o.type === 'dine_in') ? net * num(settings.service_pct) / 100 : 0;
  const ratio = lineNet > 0 ? taxable / lineNet : 0;
  const vatBase = net * ratio + svc;
  const pct = num(settings.vat_pct);
  let vat, total;
  const del = num(o.delivery_charge);
  if (settings.vat_inclusive) { vat = vatBase - vatBase / (1 + pct / 100); total = net + svc + del; }
  else { vat = vatBase * pct / 100; total = net + svc + vat + del; }
  if (settings.round_total) total = Math.round(total);
  return { subtotal: r2(subtotal), item_discount: r2(itemDisc), discount: r2(disc), service_charge: r2(svc), vat: r2(vat), delivery_charge: r2(del), total: r2(total), lineNet: r2(lineNet) };
}

async function resolveCustomer(t, tid, input) {
  let cust = null;
  if (int(input.customer_id)) cust = await t.one('SELECT * FROM customers WHERE id=$1 AND tenant_id=$2', [int(input.customer_id), tid]);
  const phone = str(input.customer_phone || (input.customer && input.customer.phone), 30);
  const name = str(input.customer_name || (input.customer && input.customer.name), 100);
  if (!cust && phone) {
    cust = await t.one('SELECT * FROM customers WHERE tenant_id=$1 AND phone=$2 ORDER BY id LIMIT 1', [tid, phone]);
    if (!cust) cust = await t.one('INSERT INTO customers(tenant_id,name,phone,address) VALUES($1,$2,$3,$4) RETURNING *', [tid, name || 'Customer', phone, str(input.address, 300)]);
  }
  if (cust && cust.blocked) fail(400, 'This customer account is restricted. Please contact the manager.');
  return cust;
}

const nextOrderNo = async (t, tid) => (await t.one('UPDATE tenants SET order_seq=order_seq+1 WHERE id=$1 RETURNING order_seq', [tid])).order_seq;

// Recalculate totals of an order from its stored items + stored discount settings
async function recalc(t, ctx, orderId) {
  const o = await t.one('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2', [orderId, ctx.tid]);
  const items = await t.all('SELECT * FROM order_items WHERE order_id=$1', [orderId]);
  const active = items.filter(i => i.kstatus !== 'cancelled');
  const lineNet = active.reduce((s, i) => s + num(i.unit_price) * num(i.qty) - num(i.discount), 0);
  let coupon = 0;
  if (o.coupon_code) { try { coupon = (await findCoupon(t, ctx.tid, o.coupon_code, lineNet, o.customer_id, items)).amount; } catch (e) { coupon = 0; } }
  const pts = num(o.points_redeemed) * num(ctx.settings.point_value, 1);
  const tot = computeTotals(items, o, ctx.settings, { coupon, points: pts });
  await t.q(`UPDATE orders SET subtotal=$2,item_discount=$3,discount=$4,service_charge=$5,vat=$6,total=$7,updated_at=now() WHERE id=$1`,
    [orderId, tot.subtotal, tot.item_discount, tot.discount, tot.service_charge, tot.vat, tot.total]);
  return tot;
}

/*
 * Create or update an order.
 * ctx = { tid, branchId, userId, settings, perms, source }
 */
async function saveOrder(t, ctx, input, orderId) {
  const perms = ctx.perms || [];
  let order = null;
  if (orderId) {
    order = await t.one('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [orderId, ctx.tid]);
    if (!order) fail(404, 'Order not found');
    if (!['open', 'held', 'pending'].includes(order.status)) fail(400, 'This order is already closed');
  } else if (input.client_uuid) {
    const dup = await t.one('SELECT * FROM orders WHERE tenant_id=$1 AND client_uuid=$2', [ctx.tid, str(input.client_uuid, 80)]);
    if (dup) return { order: dup, duplicate: true };
  }
  const type = ['dine_in', 'takeaway', 'delivery', 'drive_thru'].includes(input.type) ? input.type : (order ? order.type : 'takeaway');
  const cust = await resolveCustomer(t, ctx.tid, input);
  let tableId = type === 'dine_in' ? int(input.table_id) : null;
  if (tableId) {
    const tb = await t.one('SELECT id FROM tables WHERE id=$1 AND tenant_id=$2', [tableId, ctx.tid]);
    if (!tb) tableId = null;
  }
  let zoneId = type === 'delivery' ? int(input.zone_id) : null, delCharge = 0;
  if (type === 'delivery') {
    if (zoneId) { const z = await t.one('SELECT * FROM zones WHERE id=$1 AND tenant_id=$2', [zoneId, ctx.tid]); delCharge = z ? num(z.charge) + num(z.per_km) * num(input.distance_km) : 0; if (!z) zoneId = null; }
    if (input.delivery_charge !== undefined && input.delivery_charge !== null && input.delivery_charge !== '' && perms.includes('pos')) delCharge = num(input.delivery_charge);
  }
  const isNew = !order;
  if (!order) {
    const no = await nextOrderNo(t, ctx.tid);
    order = await t.one(`INSERT INTO orders(tenant_id,branch_id,order_no,type,source,status,cashier_id,track_token,client_uuid) VALUES($1,$2,$3,$4,$5,'open',$6,$7,$8) RETURNING *`,
      [ctx.tid, ctx.branchId, no, type, str(input.source, 40) || ctx.source || 'pos', ctx.userId || null, c.token(12), str(input.client_uuid, 80)]);
  }
  // ---- items ----
  const newItems = await buildItems(t, ctx, input.items, perms.includes('pos'));
  let existing = isNew ? [] : await t.all('SELECT * FROM order_items WHERE order_id=$1', [order.id]);
  const keepIds = new Set();
  for (const ni of newItems) {
    const ex = ni.id && existing.find(e => e.id === ni.id);
    if (ex) {
      keepIds.add(ex.id);
      if (ex.kstatus === 'draft') await t.q('UPDATE order_items SET qty=$2,discount=$3,note=$4,total=$5 WHERE id=$1', [ex.id, ni.qty, ni.discount, ni.note, r2(num(ex.unit_price) * ni.qty - ni.discount)]);
      else if (num(ni.discount) !== num(ex.discount)) await t.q('UPDATE order_items SET discount=$2,total=$3 WHERE id=$1', [ex.id, ni.discount, r2(num(ex.unit_price) * num(ex.qty) - ni.discount)]);
    }
  }
  if (!isNew) {
    for (const ex of existing) {
      if (keepIds.has(ex.id) || ex.kstatus === 'cancelled') continue;
      if (ex.kstatus === 'draft') await t.q('DELETE FROM order_items WHERE id=$1', [ex.id]);
      else {
        if (!perms.includes('void') && !ctx.approvedBy) fail(403, 'Removing an item already sent to the kitchen needs manager approval', 'APPROVAL');
        await t.q(`UPDATE order_items SET kstatus='cancelled' WHERE id=$1`, [ex.id]);
      }
    }
  }
  for (const ni of newItems) {
    if (ni.id && keepIds.has(ni.id)) continue;
    await t.q(`INSERT INTO order_items(tenant_id,order_id,product_id,name,variant,addons,qty,unit_price,discount,total,note,station_id,tax_exempt,kstatus)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft')`,
      [ctx.tid, order.id, ni.product_id, ni.name, ni.variant, JSON.stringify(ni.addons), ni.qty, ni.unit_price, ni.discount, r2(ni.unit_price * ni.qty - ni.discount), ni.note, ni.station_id, ni.tax_exempt]);
  }
  // ---- discounts ----
  const discType = ['percent', 'fixed'].includes(input.discount_type) ? input.discount_type : null;
  const discVal = discType ? Math.max(0, num(input.discount_value)) : 0;
  const itemDiscGiven = newItems.some(i => num(i.discount) > 0);
  if ((discVal > 0 || itemDiscGiven) && ctx.source === 'pos' && !perms.includes('discount') && !ctx.approvedBy) fail(403, 'Giving a discount needs manager approval', 'APPROVAL');

  const items = await t.all('SELECT * FROM order_items WHERE order_id=$1', [order.id]);
  const active = items.filter(i => i.kstatus !== 'cancelled');
  if (!active.length) fail(400, 'Add at least one item');
  const lineNet = active.reduce((s, i) => s + num(i.unit_price) * num(i.qty) - num(i.discount), 0);
  // customer-specific discount
  let dt = discType, dv = discVal;
  if (!dt && cust && num(cust.special_discount) > 0) { dt = 'percent'; dv = num(cust.special_discount); }
  const couponCode = input.coupon_code !== undefined ? str(input.coupon_code, 40) : order.coupon_code;
  const cp = couponCode ? await findCoupon(t, ctx.tid, couponCode, lineNet, cust && cust.id, items) : null;
  let pts = input.redeem_points !== undefined ? Math.max(0, num(input.redeem_points)) : num(order.points_redeemed);
  if (pts > 0) {
    if (!cust) fail(400, 'Select a customer to redeem points');
    if (pts > num(cust.points)) fail(400, `Customer has only ${cust.points} points`);
  }
  const o = { type, discount_type: dt, discount_value: dv, delivery_charge: delCharge };
  const tot = computeTotals(items, o, ctx.settings, { coupon: cp ? cp.amount : 0, points: pts * num(ctx.settings.point_value, 1) });
  const ms = input.min_order_check ? num(ctx.settings.min_order) : 0;
  if (ms > 0 && tot.lineNet < ms) fail(400, `Minimum order is ${ms}`);

  order = await t.one(`UPDATE orders SET type=$2, table_id=$3, customer_id=$4, customer_name=$5, customer_phone=$6, address=$7, zone_id=$8, delivery_charge=$9,
      waiter_id=COALESCE($10, waiter_id), guests=$11, note=$12, discount_type=$13, discount_value=$14, coupon_code=$15, points_redeemed=$16,
      subtotal=$17, item_discount=$18, discount=$19, service_charge=$20, vat=$21, total=$22, vehicle_no=$23, priority=COALESCE($24,priority),
      scheduled_at=COALESCE($25::timestamptz, scheduled_at), source=COALESCE($26, source), updated_at=now()
    WHERE id=$1 RETURNING *`,
    [order.id, type, tableId, cust ? cust.id : null, cust ? cust.name : str(input.customer_name, 100), cust ? cust.phone : str(input.customer_phone, 30),
      str(input.address, 400) || (cust && type === 'delivery' ? cust.address : null), zoneId, tot.delivery_charge, int(input.waiter_id) || (ctx.isWaiter ? ctx.userId : null),
      int(input.guests), str(input.note, 500), dt, dv, cp ? cp.coupon.code : null, pts, tot.subtotal, tot.item_discount, tot.discount, tot.service_charge, tot.vat, tot.total,
      str(input.vehicle_no, 30), typeof input.priority === 'boolean' ? input.priority : null, input.scheduled_at || null, input.source ? str(input.source, 40) : null]);

  if (input.action === 'hold') await t.q(`UPDATE orders SET status='held' WHERE id=$1`, [order.id]);
  else if (order.status === 'held') await t.q(`UPDATE orders SET status='open' WHERE id=$1`, [order.id]);
  if (input.action === 'kitchen' || input.action === 'pay') await sendToKitchen(t, ctx, order.id);
  if (tableId) await t.q(`UPDATE tables SET status='occupied', status_since=COALESCE(CASE WHEN status='occupied' THEN status_since END, now()) WHERE id=$1`, [tableId]);
  return { order: await t.one('SELECT * FROM orders WHERE id=$1', [order.id]) };
}

async function sendToKitchen(t, ctx, orderId) {
  if (ctx.settings.kds_enabled === false) await t.q(`UPDATE order_items SET kstatus='served', sent_at=now(), served_at=now() WHERE order_id=$1 AND kstatus='draft'`, [orderId]);
  else await t.q(`UPDATE order_items SET kstatus='new', sent_at=now() WHERE order_id=$1 AND kstatus='draft'`, [orderId]);
}

async function currentShift(t, ctx) {
  if (!ctx.userId) return null;
  const s = await t.one(`SELECT id FROM shifts WHERE tenant_id=$1 AND user_id=$2 AND status='open' ORDER BY id DESC LIMIT 1`, [ctx.tid, ctx.userId]);
  return s ? s.id : null;
}

async function payOrder(t, ctx, orderId, payments) {
  const order = await t.one('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [orderId, ctx.tid]);
  if (!order) fail(404, 'Order not found');
  if (!['open', 'held', 'pending'].includes(order.status)) fail(400, 'Order is already closed');
  const methods = ctx.settings.payment_methods || [];
  let remaining = r2(num(order.total) - num(order.paid)), change = 0, paidNow = 0, dueAmt = 0;
  const shiftId = await currentShift(t, ctx);
  for (const p of payments || []) {
    let amt = r2(num(p.amount));
    if (!(amt > 0) || remaining <= 0) continue;
    const method = String(p.method || 'Cash');
    if (!methods.includes(method)) fail(400, `Payment method "${method}" is not enabled`);
    if (amt > remaining) { if (method === 'Cash') change += r2(amt - remaining); amt = remaining; }
    if (method === 'Due') {
      if (!order.customer_id) fail(400, 'Select a customer before putting the bill on due (credit)');
      const cu = await t.one('SELECT due, credit_limit FROM customers WHERE id=$1', [order.customer_id]);
      if (num(cu.credit_limit) > 0 && num(cu.due) + amt > num(cu.credit_limit)) fail(400, `Customer credit limit (${cu.credit_limit}) exceeded`);
      dueAmt += amt;
    }
    await t.q('INSERT INTO order_payments(tenant_id,order_id,shift_id,branch_id,method,amount,ref,user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [ctx.tid, order.id, shiftId, order.branch_id, method, amt, str(p.ref, 80), ctx.userId || null]);
    remaining = r2(remaining - amt); paidNow += amt;
  }
  if (dueAmt > 0) await t.q('UPDATE customers SET due=due+$2 WHERE id=$1', [order.customer_id, dueAmt]);
  await t.q('UPDATE orders SET paid=paid+$2, change_due=change_due+$3, shift_id=COALESCE(shift_id,$4), cashier_id=COALESCE(cashier_id,$5) WHERE id=$1', [order.id, r2(paidNow), r2(change), shiftId, ctx.userId || null]);
  if (remaining <= 0.009) await completeOrder(t, ctx, order.id);
  return { remaining: Math.max(0, remaining), change: r2(change) };
}

async function completeOrder(t, ctx, orderId) {
  const order = await t.one('SELECT * FROM orders WHERE id=$1', [orderId]);
  await sendToKitchen(t, ctx, orderId);
  const items = await t.all(`SELECT * FROM order_items WHERE order_id=$1 AND kstatus<>'cancelled'`, [orderId]);
  // stock deduction by recipe
  const pids = [...new Set(items.map(i => i.product_id).filter(Boolean))];
  let orderCost = 0;
  if (pids.length) {
    const rec = await t.all(`SELECT r.product_id, r.ingredient_id, r.qty, i.cost, i.yield_pct FROM recipes r JOIN ingredients i ON i.id=r.ingredient_id WHERE r.tenant_id=$1 AND r.product_id = ANY($2::int[])`, [ctx.tid, pids]);
    const use = new Map();
    for (const it of items) {
      const rs = rec.filter(r => r.product_id === it.product_id);
      let unitCost = 0;
      for (const r of rs) {
        const y = num(r.yield_pct, 100) > 0 ? num(r.yield_pct, 100) / 100 : 1;
        const q = num(r.qty) / y * num(it.qty);
        unitCost += num(r.qty) / y * num(r.cost);
        use.set(r.ingredient_id, (use.get(r.ingredient_id) || 0) + q);
      }
      const cost = r2(unitCost * num(it.qty));
      orderCost += cost;
      await t.q('UPDATE order_items SET cost=$2 WHERE id=$1', [it.id, cost]);
    }
    for (const [ingId, q] of use) {
      const before = await t.one('SELECT qty FROM stock WHERE branch_id=$1 AND ingredient_id=$2', [order.branch_id, ingId]);
      await t.q(`INSERT INTO stock(tenant_id,branch_id,ingredient_id,qty) VALUES($1,$2,$3,$4) ON CONFLICT(branch_id,ingredient_id) DO UPDATE SET qty=stock.qty+$4`, [ctx.tid, order.branch_id, ingId, -q]);
      await t.q(`INSERT INTO stock_moves(tenant_id,branch_id,ingredient_id,type,qty,ref,user_id) VALUES($1,$2,$3,'sale',$4,$5,$6)`, [ctx.tid, order.branch_id, ingId, -q, 'Order #' + order.order_no, ctx.userId || null]);
      const ing = await t.one('SELECT name, min_stock, unit FROM ingredients WHERE id=$1', [ingId]);
      const prev = before ? num(before.qty) : 0;
      if (num(ing.min_stock) > 0 && prev > num(ing.min_stock) && prev - q <= num(ing.min_stock))
        await c.notify(ctx.tid, order.branch_id, 'stock', 'Low stock: ' + ing.name, `Only ${r2(prev - q)} ${ing.unit} left (minimum ${ing.min_stock}).`, '#/inventory');
    }
  }
  // customer & loyalty
  if (order.customer_id) {
    const earned = ctx.settings.loyalty_enabled && num(ctx.settings.points_per_amount) > 0 ? Math.floor(num(order.total) / num(ctx.settings.points_per_amount)) : 0;
    await t.q(`UPDATE customers SET total_spent=total_spent+$2, visits=visits+1, last_visit=now(), points=GREATEST(0, points - $3 + $4) WHERE id=$1`,
      [order.customer_id, num(order.total), num(order.points_redeemed), earned]);
  }
  if (order.coupon_code) await t.q('UPDATE coupons SET used=used+1 WHERE tenant_id=$1 AND code=$2', [ctx.tid, order.coupon_code]);
  await t.q(`UPDATE orders SET status='completed', completed_at=now(), cost=$2, updated_at=now() WHERE id=$1`, [orderId, r2(orderCost)]);
  await releaseTable(t, ctx, order.table_id);
}

async function releaseTable(t, ctx, tableId) {
  if (!tableId) return;
  const open = await t.one(`SELECT count(*)::int n FROM orders WHERE table_id=$1 AND status IN ('open','held','pending')`, [tableId]);
  if (open.n === 0) await t.q(`UPDATE tables SET status=$2, status_since=now() WHERE id=$1 AND status='occupied'`, [tableId, ctx.settings.table_cleaning ? 'cleaning' : 'available']);
}

async function voidOrder(t, ctx, orderId, reason) {
  const o = await t.one('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [orderId, ctx.tid]);
  if (!o) fail(404, 'Order not found');
  if (!['open', 'held', 'pending'].includes(o.status)) fail(400, 'Only open orders can be voided. Use refund for paid orders.');
  if (num(o.paid) > 0) {
    // money already taken on a partially paid order is returned
    await t.q('INSERT INTO refunds(tenant_id,order_id,branch_id,amount,method,reason,user_id,approved_by,shift_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [ctx.tid, o.id, o.branch_id, o.paid, 'Cash', 'Void: ' + (reason || ''), ctx.userId, ctx.approvedBy || ctx.userId, await currentShift(t, ctx)]);
    const due = await t.one(`SELECT COALESCE(sum(amount),0) s FROM order_payments WHERE order_id=$1 AND method='Due'`, [o.id]);
    if (num(due.s) > 0 && o.customer_id) await t.q('UPDATE customers SET due=GREATEST(0,due-$2) WHERE id=$1', [o.customer_id, num(due.s)]);
  }
  await t.q(`UPDATE order_items SET kstatus='cancelled' WHERE order_id=$1`, [o.id]);
  await t.q(`UPDATE orders SET status='cancelled', cancelled_at=now(), cancel_reason=$2, refunded=paid WHERE id=$1`, [o.id, str(reason, 300)]);
  await releaseTable(t, ctx, o.table_id);
}

async function refundOrder(t, ctx, orderId, b) {
  const o = await t.one('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [orderId, ctx.tid]);
  if (!o || o.status !== 'completed') fail(400, 'Only completed orders can be refunded');
  const max = r2(num(o.total) - num(o.refunded));
  const amt = r2(num(b.amount, max));
  if (!(amt > 0) || amt > max + 0.001) fail(400, `Refund amount must be between 0 and ${max}`);
  await t.q('INSERT INTO refunds(tenant_id,order_id,branch_id,amount,method,reason,restock,user_id,approved_by,shift_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [ctx.tid, o.id, o.branch_id, amt, str(b.method, 30) || 'Cash', str(b.reason, 300), !!b.restock, ctx.userId, ctx.approvedBy || ctx.userId, await currentShift(t, ctx)]);
  await t.q('UPDATE orders SET refunded=refunded+$2 WHERE id=$1', [o.id, amt]);
  if (o.customer_id) await t.q('UPDATE customers SET total_spent=GREATEST(0,total_spent-$2) WHERE id=$1', [o.customer_id, amt]);
  if (b.restock) {
    const ratio = num(o.total) > 0 ? amt / num(o.total) : 1;
    const moves = await t.all(`SELECT ingredient_id, qty FROM stock_moves WHERE tenant_id=$1 AND type='sale' AND ref=$2`, [ctx.tid, 'Order #' + o.order_no]);
    for (const m of moves) {
      const q = -num(m.qty) * ratio;
      await t.q(`UPDATE stock SET qty=qty+$3 WHERE branch_id=$1 AND ingredient_id=$2`, [o.branch_id, m.ingredient_id, q]);
      await t.q(`INSERT INTO stock_moves(tenant_id,branch_id,ingredient_id,type,qty,ref,user_id,note) VALUES($1,$2,$3,'return',$4,$5,$6,'Refund restock')`, [ctx.tid, o.branch_id, m.ingredient_id, q, 'Order #' + o.order_no, ctx.userId]);
    }
  }
  return amt;
}

async function splitOrder(t, ctx, orderId, parts) {
  const o = await t.one('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [orderId, ctx.tid]);
  if (!o || !['open', 'held'].includes(o.status)) fail(400, 'Only open orders can be split');
  if (num(o.paid) > 0) fail(400, 'This order has a partial payment; split before taking payment');
  const no = await nextOrderNo(t, ctx.tid);
  const n = await t.one(`INSERT INTO orders(tenant_id,branch_id,order_no,type,source,status,table_id,cashier_id,waiter_id,track_token,customer_id,customer_name,customer_phone)
    VALUES($1,$2,$3,$4,$5,'open',$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [ctx.tid, o.branch_id, no, o.type, o.source, o.table_id, ctx.userId, o.waiter_id, c.token(12), o.customer_id, o.customer_name, o.customer_phone]);
  let moved = 0;
  for (const p of parts || []) {
    const it = await t.one(`SELECT * FROM order_items WHERE id=$1 AND order_id=$2 AND kstatus<>'cancelled'`, [int(p.id), o.id]);
    if (!it) continue;
    const q = Math.min(num(p.qty, it.qty), num(it.qty));
    if (!(q > 0)) continue;
    if (q >= num(it.qty)) await t.q('UPDATE order_items SET order_id=$2 WHERE id=$1', [it.id, n.id]);
    else {
      const ratio = q / num(it.qty);
      await t.q('UPDATE order_items SET qty=qty-$2, discount=round(discount*(1-$3)::numeric,2), total=round((unit_price*(qty-$2) - discount*(1-$3))::numeric,2) WHERE id=$1', [it.id, q, ratio]);
      await t.q(`INSERT INTO order_items(tenant_id,order_id,product_id,name,variant,addons,qty,unit_price,discount,total,note,station_id,kstatus,sent_at,ready_at,tax_exempt)
        SELECT tenant_id,$2,product_id,name,variant,addons,$3,unit_price,round((discount*$4)::numeric,2),round((unit_price*$3 - discount*$4)::numeric,2),note,station_id,kstatus,sent_at,ready_at,tax_exempt FROM order_items WHERE id=$1`, [it.id, n.id, q, ratio]);
    }
    moved++;
  }
  if (!moved) fail(400, 'Select items to move to the new bill');
  const left = await t.one(`SELECT count(*)::int n FROM order_items WHERE order_id=$1 AND kstatus<>'cancelled'`, [o.id]);
  if (left.n === 0) fail(400, 'At least one item must stay on the original bill');
  await recalc(t, ctx, o.id); await recalc(t, ctx, n.id);
  return n.id;
}

async function mergeOrders(t, ctx, targetId, sourceIds) {
  const tg = await t.one('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [targetId, ctx.tid]);
  if (!tg || !['open', 'held'].includes(tg.status)) fail(400, 'Target bill must be open');
  for (const sid of sourceIds || []) {
    if (int(sid) === tg.id) continue;
    const s = await t.one('SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [int(sid), ctx.tid]);
    if (!s || !['open', 'held', 'pending'].includes(s.status)) continue;
    if (num(s.paid) > 0) fail(400, `Bill #${s.order_no} has a payment and cannot be merged`);
    await t.q('UPDATE order_items SET order_id=$2 WHERE order_id=$1', [s.id, tg.id]);
    await t.q(`UPDATE orders SET status='merged', merged_into=$2, subtotal=0, total=0, updated_at=now() WHERE id=$1`, [s.id, tg.id]);
    await releaseTable(t, ctx, s.table_id);
  }
  return recalc(t, ctx, tg.id);
}

module.exports = { localNow, inWindow, effectivePrice, productVisible, buildItems, computeTotals, findCoupon, saveOrder, payOrder, completeOrder, sendToKitchen, voidOrder, refundOrder, splitOrder, mergeOrders, recalc, releaseTable, currentShift, nextOrderNo };
