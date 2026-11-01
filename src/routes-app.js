// Restaurant (tenant) API — part 1: account, settings, staff, billing, POS, orders, shifts, kitchen, tables, delivery, customers, attendance
const express = require('express');
const QRCode = require('qrcode');
const db = require('./db');
const c = require('./core');
const O = require('./orders');
const { wrap, fail, str, num, int, r2, requireUser: U } = c;
const r = express.Router();

const ctxOf = (req, extra = {}) => Object.assign({ tid: req.tid, branchId: req.branchId, userId: req.user.id, settings: req.tenant.settings, perms: req.user.perms, source: 'pos', isWaiter: req.user.role_key === 'waiter' }, extra);
const tz = req => req.tenant.settings.timezone || 'Asia/Dhaka';
const origin = req => `${req.protocol}://${req.get('host')}`;

// ================= account =================
r.get('/me', U(null, { allowInactive: true }), wrap(async (req, res) => {
  const branches = await db.all('SELECT id, name, active FROM branches WHERE tenant_id=$1 ORDER BY id', [req.tid]);
  const s = await c.getSettings();
  const ann = await db.all('SELECT id, title, body, level FROM announcements WHERE active ORDER BY id DESC LIMIT 3');
  const unread = await db.one('SELECT count(*)::int n FROM notifications WHERE tenant_id=$1 AND NOT read AND (branch_id IS NULL OR branch_id=$2)', [req.tid, req.branchId]);
  const t = await db.one('SELECT name, slug, status, expires_at, phone, email, address, owner_name FROM tenants WHERE id=$1', [req.tid]);
  res.json({
    user: req.user, tenant: Object.assign(t, { status: req.tenant.status, settings: req.tenant.settings }), branch_id: req.branchId,
    branch_locked: !!req.user.branch_id, branches, perm_labels: c.PERMS, announcements: ann, unread: unread.n,
    brand: { name: s.brand.name, logo_id: s.brand.logo_id, color: s.brand.color, phone: s.brand.phone, email: s.brand.email },
    plan: { name: s.plan.name, name_bn: s.plan.name_bn, price: s.plan.price, duration_days: s.plan.duration_days, periods: s.plan.periods.filter(x => x.active !== false) }, default_lang: s.default_lang
  });
}));
r.get('/meta', U(null), wrap(async (req, res) => {
  const { RES } = require('./routes-resources');
  res.json({ resources: RES, perms: c.PERMS });
}));
r.post('/switch-branch', U(null), wrap(async (req, res) => {
  if (req.user.branch_id) fail(403, 'Your login is fixed to one branch');
  const b = await db.one('SELECT id FROM branches WHERE id=$1 AND tenant_id=$2', [int(req.body.branch_id), req.tid]);
  if (!b) fail(404, 'Branch not found');
  await db.q('UPDATE sessions SET branch_id=$2 WHERE id=$1', [req.user.sid, b.id]);
  res.json({ ok: true });
}));
r.post('/upload', U(null), wrap(async (req, res) => {
  const id = await require('./routes-super').saveImage(req.tid, req.body.data);
  res.json({ id });
}));
r.post('/change-password', U(null, { allowInactive: true }), wrap(async (req, res) => {
  const u = await db.one('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!(await c.check(req.body.current || '', u.password_hash))) fail(400, 'Current password is wrong');
  if (!req.body.password || String(req.body.password).length < 6) fail(400, 'New password must be at least 6 characters');
  await db.q('UPDATE users SET password_hash=$2 WHERE id=$1', [req.user.id, await c.hash(req.body.password)]);
  await db.q(`DELETE FROM sessions WHERE kind='user' AND user_id=$1 AND id<>$2`, [req.user.id, req.user.sid]);
  res.json({ ok: true });
}));
r.post('/my-pin', U(null), wrap(async (req, res) => {
  if (!/^\d{4,6}$/.test(String(req.body.pin || ''))) fail(400, 'PIN must be 4 to 6 digits');
  await assertPinFree(req.tid, req.body.pin, req.user.id);
  await db.q('UPDATE users SET pin_hash=$2 WHERE id=$1', [req.user.id, await c.hash(req.body.pin)]);
  res.json({ ok: true });
}));
async function assertPinFree(tid, pin, exceptId) {
  const users = await db.all('SELECT id, pin_hash FROM users WHERE tenant_id=$1 AND pin_hash IS NOT NULL AND id<>$2', [tid, exceptId || 0]);
  for (const u of users) if (await c.check(String(pin), u.pin_hash)) fail(400, 'This PIN is already used by another staff member. Choose a different PIN.');
}

// ================= notifications / live polling =================
r.get('/poll', U(null, { allowInactive: true }), wrap(async (req, res) => {
  const since = int(req.query.since, 0);
  const list = await db.all(`SELECT id, type, title, body, link, created_at FROM notifications WHERE tenant_id=$1 AND id>$2 AND (branch_id IS NULL OR branch_id=$3) ORDER BY id DESC LIMIT 20`, [req.tid, since, req.branchId]);
  const counts = await db.one(`SELECT
    (SELECT count(*)::int FROM notifications WHERE tenant_id=$1 AND NOT read AND (branch_id IS NULL OR branch_id=$2)) unread,
    (SELECT count(*)::int FROM orders WHERE tenant_id=$1 AND branch_id=$2 AND status='pending') pending_online,
    (SELECT max(id) FROM notifications WHERE tenant_id=$1) last_id`, [req.tid, req.branchId]);
  res.json(Object.assign(counts, { items: list }));
}));
r.get('/notifications', U(null, { allowInactive: true }), wrap(async (req, res) => {
  res.json(await db.all(`SELECT * FROM notifications WHERE tenant_id=$1 AND (branch_id IS NULL OR branch_id=$2) ORDER BY id DESC LIMIT 100`, [req.tid, req.branchId]));
}));
r.post('/notifications/read', U(null, { allowInactive: true }), wrap(async (req, res) => {
  await db.q('UPDATE notifications SET read=true WHERE tenant_id=$1 AND (branch_id IS NULL OR branch_id=$2)', [req.tid, req.branchId]);
  res.json({ ok: true });
}));

// ================= restaurant settings =================
const SETTING_KEYS = Object.keys(c.TENANT_DEFAULTS).concat(['phone', 'address', 'color']);
r.get('/settings', U('settings'), wrap(async (req, res) => {
  const t = await db.one('SELECT name, slug, owner_name, phone, email, address FROM tenants WHERE id=$1', [req.tid]);
  res.json({ tenant: t, settings: req.tenant.settings, menu_url: `${origin(req)}/m/${t.slug}`, board_url: `${origin(req)}/board/${t.slug}`, kiosk_url: `${origin(req)}/m/${t.slug}?kiosk=1`, display_url: `${origin(req)}/display` });
}));
r.put('/settings', U('settings'), wrap(async (req, res) => {
  const b = req.body || {};
  const s = Object.assign({}, req.tenant.settings);
  for (const k of SETTING_KEYS) if (b.settings && b.settings[k] !== undefined) s[k] = b.settings[k];
  ['vat_pct', 'service_pct', 'points_per_amount', 'point_value', 'min_order', 'kds_delay_min', 'receipt_width'].forEach(k => { s[k] = num(s[k]); });
  s.payment_methods = (Array.isArray(s.payment_methods) ? s.payment_methods : []).map(x => String(x).trim()).filter(Boolean).slice(0, 15);
  if (!s.payment_methods.includes('Cash')) s.payment_methods.unshift('Cash');
  s.order_sources = (Array.isArray(s.order_sources) ? s.order_sources : []).map(x => String(x).trim()).filter(Boolean).slice(0, 15);
  if (s.menu_theme && typeof s.menu_theme === 'object') {
    const T = s.menu_theme, hex = v => /^#[0-9a-f]{6}$/i.test(v || '') ? v : undefined;
    s.menu_theme = { preset: str(T.preset, 30) || 'classic', layout: ['list', 'grid', 'compact', 'magazine'].includes(T.layout) ? T.layout : undefined,
      primary: hex(T.primary), accent: hex(T.accent), bg: hex(T.bg), card: hex(T.card), text: hex(T.text), header: hex(T.header),
      font: ['sans', 'serif', 'rounded'].includes(T.font) ? T.font : undefined, radius: Math.max(0, Math.min(28, int(T.radius, 14))),
      show_images: T.show_images !== false, show_desc: T.show_desc !== false, cover_id: int(T.cover_id) || null };
  } else s.menu_theme = { preset: 'classic' };
  if (!['bn', 'en'].includes(s.menu_lang)) s.menu_lang = 'bn';
  if (!['bn', 'en'].includes(s.ui_lang)) s.ui_lang = 'en';
  if (s.sms_url && !/^https?:\/\//i.test(s.sms_url)) fail(400, 'SMS gateway URL must start with http:// or https://');
  try { new Intl.DateTimeFormat('en', { timeZone: s.timezone }); } catch (e) { fail(400, 'Invalid time zone'); }
  const t = b.tenant || {};
  await db.q('UPDATE tenants SET settings=$2, name=COALESCE($3,name), owner_name=COALESCE($4,owner_name), phone=COALESCE($5,phone), email=COALESCE($6,email), address=COALESCE($7,address) WHERE id=$1',
    [req.tid, JSON.stringify(s), str(t.name, 120), str(t.owner_name, 100), str(t.phone, 30), str(t.email, 120), str(t.address, 300)]);
  await c.audit(req, 'update', 'settings', null);
  res.json({ ok: true, settings: s });
}));

// ================= staff users & roles =================
r.get('/users', U(['settings', 'staff']), wrap(async (req, res) => {
  res.json(await db.all(`SELECT u.id,u.name,u.username,u.phone,u.email,u.branch_id,u.role_id,u.active,u.salary,u.designation,u.address,u.joined_at,u.last_login,
    (u.pin_hash IS NOT NULL) has_pin, r.name role_name, r.is_owner, b.name branch_name
    FROM users u LEFT JOIN roles r ON r.id=u.role_id LEFT JOIN branches b ON b.id=u.branch_id WHERE u.tenant_id=$1 ORDER BY u.active DESC, u.name`, [req.tid]));
}));
async function saveUser(req, id) {
  const b = req.body || {};
  const role = await db.one('SELECT * FROM roles WHERE id=$1 AND tenant_id=$2', [int(b.role_id), req.tid]);
  if (!role) fail(400, 'Choose a role');
  if (role.is_owner && !req.user.is_owner) fail(403, 'Only an owner can create or edit owner accounts');
  let existing = null;
  if (id) {
    existing = await db.one('SELECT u.*, r.is_owner FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=$1 AND u.tenant_id=$2', [id, req.tid]);
    if (!existing) fail(404, 'Not found');
    if (existing.is_owner && !req.user.is_owner) fail(403, 'Only an owner can edit an owner account');
    if (existing.is_owner && (!role.is_owner || b.active === false)) {
      const owners = await db.one('SELECT count(*)::int n FROM users u JOIN roles r ON r.id=u.role_id WHERE u.tenant_id=$1 AND r.is_owner AND u.active', [req.tid]);
      if (owners.n <= 1) fail(400, 'You need at least one active owner');
    }
  }
  const username = String(b.username || '').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
  if (!b.name || !username) fail(400, 'Name and username are required');
  const branchId = int(b.branch_id) || null;
  if (branchId && !(await db.one('SELECT 1 FROM branches WHERE id=$1 AND tenant_id=$2', [branchId, req.tid]))) fail(400, 'Branch not found');
  if (!id && (!b.password || String(b.password).length < 6) && !b.pin) fail(400, 'Set a password (6+ characters) or a PIN');
  if (b.password && String(b.password).length < 6) fail(400, 'Password must be at least 6 characters');
  if (b.pin && !/^\d{4,6}$/.test(String(b.pin))) fail(400, 'PIN must be 4 to 6 digits');
  if (b.pin) await assertPinFree(req.tid, b.pin, id);
  const vals = [req.tid, branchId, role.id, str(b.name, 100), username, str(b.phone, 30), str(b.email, 120), num(b.salary), str(b.designation, 80), str(b.address, 300), b.joined_at || null, b.active !== false];
  let row;
  if (id) row = await db.one(`UPDATE users SET branch_id=$2, role_id=$3, name=$4, username=$5, phone=$6, email=$7, salary=$8, designation=$9, address=$10, joined_at=$11, active=$12 WHERE id=$13 AND tenant_id=$1 RETURNING id`, [...vals, id]);
  else row = await db.one(`INSERT INTO users(tenant_id,branch_id,role_id,name,username,phone,email,salary,designation,address,joined_at,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, vals);
  if (b.password) await db.q('UPDATE users SET password_hash=$2 WHERE id=$1', [row.id, await c.hash(b.password)]);
  if (b.pin) await db.q('UPDATE users SET pin_hash=$2 WHERE id=$1', [row.id, await c.hash(b.pin)]);
  if (b.remove_pin) await db.q('UPDATE users SET pin_hash=NULL WHERE id=$1', [row.id]);
  if (id && (b.active === false || b.password)) await db.q(`DELETE FROM sessions WHERE kind='user' AND user_id=$1 AND id<>$2`, [row.id, req.user.sid]);
  await c.audit(req, id ? 'update' : 'create', 'user', row.id, { username, role: role.name });
  return row;
}
r.post('/users', U('settings'), wrap(async (req, res) => res.json(await saveUser(req, null))));
r.put('/users/:id', U('settings'), wrap(async (req, res) => res.json(await saveUser(req, int(req.params.id)))));

r.get('/roles', U(['settings', 'staff']), wrap(async (req, res) => {
  res.json(await db.all('SELECT r.*, (SELECT count(*)::int FROM users u WHERE u.role_id=r.id) users FROM roles r WHERE tenant_id=$1 ORDER BY is_owner DESC, id', [req.tid]));
}));
async function saveRole(req, id) {
  const b = req.body || {};
  if (!b.name) fail(400, 'Role name is required');
  const perms = (b.perms || []).filter(p => c.PERMS[p]);
  if (id) {
    const ex = await db.one('SELECT * FROM roles WHERE id=$1 AND tenant_id=$2', [id, req.tid]);
    if (!ex) fail(404, 'Not found');
    if (ex.is_owner) fail(400, 'The Owner role always has every permission');
    return db.one('UPDATE roles SET name=$3, perms=$4 WHERE id=$1 AND tenant_id=$2 RETURNING *', [id, req.tid, str(b.name, 60), JSON.stringify(perms)]);
  }
  return db.one('INSERT INTO roles(tenant_id,key,name,perms) VALUES($1,$2,$3,$4) RETURNING *', [req.tid, c.slugify(b.name), str(b.name, 60), JSON.stringify(perms)]);
}
r.post('/roles', U('settings'), wrap(async (req, res) => { const row = await saveRole(req, null); await c.audit(req, 'create', 'role', row.id, { name: row.name }); res.json(row); }));
r.put('/roles/:id', U('settings'), wrap(async (req, res) => { const row = await saveRole(req, int(req.params.id)); await c.audit(req, 'update', 'role', row.id, { name: row.name, perms: row.perms }); res.json(row); }));
r.delete('/roles/:id', U('settings'), wrap(async (req, res) => {
  const ex = await db.one('SELECT r.*, (SELECT count(*)::int FROM users u WHERE u.role_id=r.id) n FROM roles r WHERE id=$1 AND tenant_id=$2', [int(req.params.id), req.tid]);
  if (!ex) fail(404, 'Not found');
  if (ex.is_owner) fail(400, 'The Owner role cannot be deleted');
  if (ex.n) fail(400, 'Move the staff in this role to another role first');
  await db.q('DELETE FROM roles WHERE id=$1', [ex.id]); res.json({ ok: true });
}));
r.get('/audit', U('settings'), wrap(async (req, res) => {
  const p = [req.tid]; let w = '';
  if (req.query.q) { p.push('%' + req.query.q + '%'); w = ` AND (user_name ILIKE $2 OR action ILIKE $2 OR entity ILIKE $2 OR details::text ILIKE $2)`; }
  res.json(await db.all(`SELECT * FROM audit_logs WHERE tenant_id=$1 ${w} ORDER BY id DESC LIMIT 300`, p));
}));
r.get('/logins', U('settings'), wrap(async (req, res) => res.json(await db.all('SELECT * FROM login_logs WHERE tenant_id=$1 ORDER BY id DESC LIMIT 200', [req.tid]))));
r.get('/sessions', U('settings'), wrap(async (req, res) => {
  res.json(await db.all(`SELECT s.id, s.created_at, s.last_seen, s.ip, s.ua, s.impersonated, u.name, u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.tenant_id=$1 AND s.kind='user' AND s.expires_at>now() ORDER BY s.last_seen DESC`, [req.tid]));
}));
r.delete('/sessions/:id', U('settings'), wrap(async (req, res) => {
  await db.q(`DELETE FROM sessions WHERE id=$1 AND tenant_id=$2 AND kind='user'`, [String(req.params.id), req.tid]); res.json({ ok: true });
}));
r.get('/export', U('settings'), wrap(async (req, res) => {
  const data = await require('./routes-super').dumpTenant(req.tid);
  await c.audit(req, 'export', 'backup', null);
  res.setHeader('Content-Disposition', `attachment; filename="${req.tenant.slug}-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
}));

// ================= billing (subscription) =================
r.get('/billing', U(null, { allowInactive: true }), wrap(async (req, res) => {
  const s = await c.getSettings();
  const pays = await db.all('SELECT id, amount, method, trx_id, days, status, note, created_at, decided_at FROM sub_payments WHERE tenant_id=$1 ORDER BY id DESC', [req.tid]);
  res.json({ status: req.tenant.status, expires_at: req.tenant.expires_at, plan: s.plan, payment: s.payment, payments: pays, brand: { phone: s.brand.phone, email: s.brand.email } });
}));
r.post('/billing/pay', U(null, { allowInactive: true }), wrap(async (req, res) => {
  if (!req.user.is_owner && !c.can(req, 'settings')) fail(403, 'Only the owner can submit payments');
  const b = req.body || {}; const s = await c.getSettings();
  if (!b.trx_id || !b.method) fail(400, 'Payment method and transaction ID are required');
  const per = c.findPeriod(s.plan, b.months || (b.period === 'yearly' ? 12 : 1));
  if (!per) fail(400, 'No billing period is available. Please contact support.');
  if (b.months && Number(per.months) !== Number(b.months)) fail(400, 'This billing period is not available any more. Please refresh the page and choose again.');
  const amount = Number(per.price), days = Number(per.days) || Math.round(Number(per.months) * 30);
  const dup = await db.one(`SELECT 1 FROM sub_payments WHERE trx_id=$1 AND status<>'rejected'`, [str(b.trx_id, 80)]);
  if (dup) fail(400, 'This transaction ID was already submitted');
  await db.q('INSERT INTO sub_payments(tenant_id,amount,method,trx_id,sender,days) VALUES($1,$2,$3,$4,$5,$6)', [req.tid, amount, str(b.method, 40), str(b.trx_id, 80), str(b.sender, 40), days]);
  res.json({ ok: true });
}));

// ================= POS =================
r.get('/pos/bootstrap', U(['pos', 'tables']), wrap(async (req, res) => {
  const s = req.tenant.settings;
  const now = O.localNow(s.timezone);
  const cats = await db.all('SELECT id, name, image_id, station_id FROM categories WHERE tenant_id=$1 AND active ORDER BY sort, id', [req.tid]);
  const prods = (await db.all('SELECT * FROM products WHERE tenant_id=$1 AND active ORDER BY sort, name', [req.tid]))
    .filter(p => { const b = p.branch_ids || []; return !b.length || b.map(String).includes(String(req.branchId)); })
    .map(p => ({ id: p.id, category_id: p.category_id, name: p.name, price: O.effectivePrice(p, req.branchId, now), base_price: num(p.price), image_id: p.image_id, variants: p.variants, addons: p.addons,
      sku: p.sku, barcode: p.barcode, by_weight: p.by_weight, available: p.available && O.productVisible(p, req.branchId, now), happy: p.happy_price != null && O.inWindow(p.happy_from, p.happy_to, now.hm) && !!p.happy_from }));
  const floors = await db.all('SELECT id, name FROM floors WHERE tenant_id=$1 AND branch_id=$2 ORDER BY sort, id', [req.tid, req.branchId]);
  const tables = await db.all(`SELECT t.id, t.name, t.floor_id, t.seats, t.status, t.waiter_id,
      (SELECT count(*)::int FROM orders o WHERE o.table_id=t.id AND o.status IN ('open','held','pending')) open_orders
    FROM tables t WHERE t.tenant_id=$1 AND t.branch_id=$2 ORDER BY t.name`, [req.tid, req.branchId]);
  const zones = await db.all('SELECT id, name, charge, per_km, min_order FROM zones WHERE tenant_id=$1 AND active ORDER BY id', [req.tid]);
  const waiters = await db.all(`SELECT u.id, u.name FROM users u JOIN roles r ON r.id=u.role_id WHERE u.tenant_id=$1 AND u.active AND (u.branch_id IS NULL OR u.branch_id=$2) ORDER BY u.name`, [req.tid, req.branchId]);
  const riders = await db.all('SELECT id, name, phone, available FROM riders WHERE tenant_id=$1 AND branch_id=$2 AND active ORDER BY name', [req.tid, req.branchId]);
  const shift = await db.one(`SELECT * FROM shifts WHERE tenant_id=$1 AND user_id=$2 AND status='open' ORDER BY id DESC LIMIT 1`, [req.tid, req.user.id]);
  const branch = await db.one('SELECT name, address, phone FROM branches WHERE id=$1', [req.branchId]);
  const t = await db.one('SELECT name, phone, address FROM tenants WHERE id=$1', [req.tid]);
  res.json({
    categories: cats, products: prods, floors, tables, zones, waiters, riders, shift,
    settings: { currency: s.currency, vat_pct: s.vat_pct, vat_inclusive: s.vat_inclusive, service_pct: s.service_pct, service_dine_in_only: s.service_dine_in_only, round_total: s.round_total,
      payment_methods: s.payment_methods, order_sources: s.order_sources, receipt_header: s.receipt_header, receipt_footer: s.receipt_footer, receipt_width: s.receipt_width,
      bin: s.bin, logo_id: s.logo_id, loyalty_enabled: s.loyalty_enabled, point_value: s.point_value, kds_enabled: s.kds_enabled },
    restaurant: { name: t.name, phone: s.phone || branch.phone || t.phone, address: branch.address || s.address || t.address, branch: branch.name }
  });
}));
r.get('/customers/search', U(['pos', 'customers', 'delivery', 'reservations']), wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  res.json(await db.all(`SELECT id, name, phone, address, points, due, credit_limit, blocked, special_discount, visits, preferences FROM customers WHERE tenant_id=$1 AND (phone ILIKE $2 OR name ILIKE $2) ORDER BY visits DESC LIMIT 10`, [req.tid, '%' + q + '%']));
}));
r.post('/coupon-check', U('pos'), wrap(async (req, res) => {
  const out = await db.tx(t => O.findCoupon(t, req.tid, req.body.code, num(req.body.subtotal), int(req.body.customer_id), req.body.items || []));
  res.json({ code: out.coupon.code, type: out.coupon.type, value: out.coupon.value, discount: out.amount });
}));

async function orderDetail(tid, id, req) {
  const o = await db.one(`SELECT o.*, t.name table_name, w.name waiter_name, ca.name cashier_name, rd.name rider_name, rd.phone rider_phone, b.name branch_name, z.name zone_name
    FROM orders o LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN users w ON w.id=o.waiter_id LEFT JOIN users ca ON ca.id=o.cashier_id
    LEFT JOIN riders rd ON rd.id=o.rider_id LEFT JOIN branches b ON b.id=o.branch_id LEFT JOIN zones z ON z.id=o.zone_id WHERE o.id=$1 AND o.tenant_id=$2`, [id, tid]);
  if (!o || (req && req.user.branch_id && o.branch_id !== req.user.branch_id)) fail(404, 'Order not found');
  o.items = await db.all('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [id]);
  o.payments = await db.all('SELECT p.*, u.name user_name FROM order_payments p LEFT JOIN users u ON u.id=p.user_id WHERE order_id=$1 ORDER BY id', [id]);
  o.refunds = await db.all('SELECT f.*, u.name user_name FROM refunds f LEFT JOIN users u ON u.id=f.user_id WHERE order_id=$1 ORDER BY id', [id]);
  if (o.customer_id) o.customer = await db.one('SELECT id, name, phone, points, due FROM customers WHERE id=$1', [o.customer_id]);
  return o;
}
async function approval(req, perm) {
  // returns approver id when the user lacks the permission but a valid manager PIN was supplied
  if (c.can(req, perm)) return null;
  if (!req.body.approver_pin) return null;
  return c.approve(req, perm, req.body.approver_pin);
}

r.get('/orders', U(['orders', 'pos', 'delivery', 'accounting']), wrap(async (req, res) => {
  const p = [req.tid]; let w = 'o.tenant_id=$1';
  if (!(req.query.branch === 'all' && !req.user.branch_id)) { p.push(req.branchId); w += ` AND o.branch_id=$${p.length}`; }
  if (req.query.status) { p.push(String(req.query.status).split(',')); w += ` AND o.status = ANY($${p.length})`; }
  if (req.query.type) { p.push(req.query.type); w += ` AND o.type=$${p.length}`; }
  if (req.query.table_id) { p.push(int(req.query.table_id)); w += ` AND o.table_id=$${p.length}`; }
  if (req.query.customer_id) { p.push(int(req.query.customer_id)); w += ` AND o.customer_id=$${p.length}`; }
  if (req.query.q) { p.push('%' + req.query.q + '%'); w += ` AND (o.order_no::text = $${p.length - 0}::text OR o.customer_name ILIKE $${p.length} OR o.customer_phone ILIKE $${p.length} OR o.order_no::text ILIKE $${p.length})`; }
  if (req.query.from) { p.push(tz(req), req.query.from); w += ` AND (o.created_at AT TIME ZONE $${p.length - 1})::date >= $${p.length}`; }
  if (req.query.to) { p.push(tz(req), req.query.to); w += ` AND (o.created_at AT TIME ZONE $${p.length - 1})::date <= $${p.length}`; }
  const mine = req.user.role_key === 'waiter' && req.query.mine === '1';
  if (mine) { p.push(req.user.id); w += ` AND o.waiter_id=$${p.length}`; }
  const limit = Math.min(int(req.query.limit, 200) || 200, 1000);
  res.json(await db.all(`SELECT o.id, o.order_no, o.type, o.source, o.status, o.total, o.paid, o.refunded, o.created_at, o.completed_at, o.customer_name, o.customer_phone, o.delivery_status, o.priority,
      o.payment_note, o.address, o.note, o.scheduled_at, o.guests, t.name table_name, w.name waiter_name, rd.name rider_name,
      (SELECT count(*)::int FROM order_items i WHERE i.order_id=o.id AND i.kstatus<>'cancelled') items,
      (SELECT count(*)::int FROM order_items i WHERE i.order_id=o.id AND i.kstatus='ready') ready_items
    FROM orders o LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN users w ON w.id=o.waiter_id LEFT JOIN riders rd ON rd.id=o.rider_id
    WHERE ${w} ORDER BY o.id DESC LIMIT ${limit}`, p));
}));
r.get('/orders/:id', U(['orders', 'pos', 'delivery', 'accounting']), wrap(async (req, res) => res.json(await orderDetail(req.tid, int(req.params.id), req))));

r.post('/orders', U('pos'), wrap(async (req, res) => {
  const b = req.body || {};
  const approvedBy = (await approval(req, 'discount')) || null;
  const out = await db.tx(async t => {
    const ctx = ctxOf(req, { approvedBy });
    const { order, duplicate } = await O.saveOrder(t, ctx, b, null);
    let pay = null;
    if (!duplicate && b.action === 'pay') pay = await O.payOrder(t, ctx, order.id, b.payments || []);
    return { id: order.id, duplicate, pay };
  });
  if (!out.duplicate) await c.audit(req, 'create', 'order', out.id, approvedBy ? { approved_by: approvedBy } : null);
  res.json(Object.assign(await orderDetail(req.tid, out.id, req), { pay_result: out.pay }));
}));
r.put('/orders/:id', U('pos'), wrap(async (req, res) => {
  const b = req.body || {};
  const approvedBy = (await approval(req, 'void')) || (await approval(req, 'discount')) || null;
  const out = await db.tx(async t => {
    const ctx = ctxOf(req, { approvedBy });
    const { order } = await O.saveOrder(t, ctx, b, int(req.params.id));
    let pay = null;
    if (b.action === 'pay') pay = await O.payOrder(t, ctx, order.id, b.payments || []);
    return { id: order.id, pay };
  });
  res.json(Object.assign(await orderDetail(req.tid, out.id, req), { pay_result: out.pay }));
}));
r.post('/orders/:id/pay', U('pos'), wrap(async (req, res) => {
  const pay = await db.tx(t => O.payOrder(t, ctxOf(req), int(req.params.id), req.body.payments || []));
  res.json(Object.assign(await orderDetail(req.tid, int(req.params.id), req), { pay_result: pay }));
}));
r.post('/orders/:id/kitchen', U('pos'), wrap(async (req, res) => {
  await db.tx(t => O.sendToKitchen(t, ctxOf(req), int(req.params.id)));
  res.json(await orderDetail(req.tid, int(req.params.id), req));
}));
r.post('/orders/:id/void', U(['pos', 'orders']), wrap(async (req, res) => {
  const by = await c.approve(req, 'void', req.body.approver_pin);
  if (!req.body.reason) fail(400, 'Please write a reason for cancelling');
  await db.tx(t => O.voidOrder(t, ctxOf(req, { approvedBy: by }), int(req.params.id), req.body.reason));
  await c.audit(req, 'void', 'order', int(req.params.id), { reason: req.body.reason, approved_by: by });
  res.json({ ok: true });
}));
r.post('/orders/:id/refund', U(['pos', 'orders']), wrap(async (req, res) => {
  const by = await c.approve(req, 'refund', req.body.approver_pin);
  const amt = await db.tx(t => O.refundOrder(t, ctxOf(req, { approvedBy: by }), int(req.params.id), req.body));
  await c.audit(req, 'refund', 'order', int(req.params.id), { amount: amt, reason: req.body.reason, approved_by: by });
  res.json({ ok: true, amount: amt });
}));
r.post('/orders/:id/split', U('pos'), wrap(async (req, res) => {
  const newId = await db.tx(t => O.splitOrder(t, ctxOf(req), int(req.params.id), req.body.items));
  await c.audit(req, 'split', 'order', int(req.params.id), { new_order: newId });
  res.json({ ok: true, new_id: newId });
}));
r.post('/orders/merge', U('pos'), wrap(async (req, res) => {
  await db.tx(t => O.mergeOrders(t, ctxOf(req), int(req.body.target_id), (req.body.source_ids || []).map(x => int(x))));
  await c.audit(req, 'merge', 'order', int(req.body.target_id), { sources: req.body.source_ids });
  res.json(await orderDetail(req.tid, int(req.body.target_id), req));
}));
r.post('/orders/:id/transfer', U(['pos', 'tables']), wrap(async (req, res) => {
  await db.tx(async t => {
    const o = await t.one(`SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 AND status IN ('open','held')`, [int(req.params.id), req.tid]);
    if (!o) fail(400, 'Order is not open');
    const tb = await t.one('SELECT id FROM tables WHERE id=$1 AND tenant_id=$2 AND branch_id=$3', [int(req.body.table_id), req.tid, o.branch_id]);
    if (!tb) fail(400, 'Table not found');
    await t.q(`UPDATE orders SET table_id=$2, type='dine_in', updated_at=now() WHERE id=$1`, [o.id, tb.id]);
    await t.q(`UPDATE tables SET status='occupied', status_since=COALESCE(CASE WHEN status='occupied' THEN status_since END, now()) WHERE id=$1`, [tb.id]);
    await O.releaseTable(t, ctxOf(req), o.table_id);
  });
  await c.audit(req, 'transfer', 'order', int(req.params.id), { table_id: req.body.table_id });
  res.json({ ok: true });
}));
r.post('/orders/:id/priority', U(['pos', 'kitchen']), wrap(async (req, res) => {
  await db.q('UPDATE orders SET priority=NOT priority WHERE id=$1 AND tenant_id=$2', [int(req.params.id), req.tid]); res.json({ ok: true });
}));
r.post('/orders/:id/serve', U(['pos', 'tables', 'kitchen']), wrap(async (req, res) => {
  await db.q(`UPDATE order_items SET kstatus='served', served_at=now() WHERE order_id=$1 AND tenant_id=$2 AND kstatus IN ('ready','new','preparing')`, [int(req.params.id), req.tid]);
  res.json({ ok: true });
}));
r.post('/orders/:id/accept', U(['pos', 'orders']), wrap(async (req, res) => {
  let mergedInto = null;
  const o = await db.tx(async t => {
    const o = await t.one(`SELECT * FROM orders WHERE id=$1 AND tenant_id=$2 AND status='pending' FOR UPDATE`, [int(req.params.id), req.tid]);
    if (!o) fail(400, 'Order is not waiting for acceptance');
    await t.q(`UPDATE orders SET status='open', cashier_id=$2, updated_at=now() WHERE id=$1`, [o.id, req.user.id]);
    await O.sendToKitchen(t, ctxOf(req), o.id);
    if (o.table_id) {
      const ex = await t.one(`SELECT id FROM orders WHERE table_id=$1 AND status IN ('open','held') AND id<>$2 AND paid=0 ORDER BY id LIMIT 1`, [o.table_id, o.id]);
      if (ex) { await O.mergeOrders(t, ctxOf(req), ex.id, [o.id]); mergedInto = ex.id; }
    }
    return o;
  });
  const s = req.tenant.settings;
  if (o.customer_phone && s.sms_events && s.sms_events.online_accept) c.sendSMS(s, o.customer_phone, `${req.tenant.name}: your order #${o.order_no} is confirmed and being prepared. Track: ${origin(req)}/track/${o.track_token}`);
  await c.audit(req, 'accept', 'order', o.id);
  res.json({ ok: true, merged_into: mergedInto });
}));
r.post('/orders/:id/reject', U(['pos', 'orders']), wrap(async (req, res) => {
  const o = await db.one(`UPDATE orders SET status='rejected', cancel_reason=$3, cancelled_at=now() WHERE id=$1 AND tenant_id=$2 AND status='pending' RETURNING *`, [int(req.params.id), req.tid, str(req.body.reason, 300)]);
  if (!o) fail(400, 'Order is not pending');
  await db.q(`UPDATE order_items SET kstatus='cancelled' WHERE order_id=$1`, [o.id]);
  await db.tx(t => O.releaseTable(t, ctxOf(req), o.table_id));
  await c.audit(req, 'reject', 'order', o.id, { reason: req.body.reason });
  res.json({ ok: true });
}));
r.post('/orders/:id/delivery', U(['delivery', 'pos']), wrap(async (req, res) => {
  const st = req.body.status;
  if (st && !['assigned', 'picked', 'delivered', 'failed'].includes(st)) fail(400, 'Invalid status');
  const riderId = req.body.rider_id !== undefined ? int(req.body.rider_id) : undefined;
  if (riderId && !(await db.one('SELECT 1 FROM riders WHERE id=$1 AND tenant_id=$2', [riderId, req.tid]))) fail(400, 'Rider not found');
  const o = await db.one(`UPDATE orders SET rider_id=COALESCE($3, rider_id), delivery_status=COALESCE($4, CASE WHEN $3::int IS NOT NULL THEN 'assigned' ELSE delivery_status END), updated_at=now()
    WHERE id=$1 AND tenant_id=$2 AND type='delivery' RETURNING *`, [int(req.params.id), req.tid, riderId || null, st || null]);
  if (!o) fail(404, 'Delivery order not found');
  if (o.rider_id && (st === 'picked')) await db.q('UPDATE riders SET available=false WHERE id=$1', [o.rider_id]);
  if (o.rider_id && (st === 'delivered' || st === 'failed')) await db.q('UPDATE riders SET available=true WHERE id=$1', [o.rider_id]);
  if (st === 'delivered') await db.q(`UPDATE order_items SET kstatus='served', served_at=COALESCE(served_at, now()) WHERE order_id=$1 AND kstatus<>'cancelled'`, [o.id]);
  await c.audit(req, 'delivery', 'order', o.id, { status: st, rider_id: riderId });
  res.json({ ok: true });
}));

// ================= cash shifts / drawer =================
async function shiftReport(tid, shift) {
  const pays = await db.all('SELECT method, sum(amount) amount, count(*)::int n FROM order_payments WHERE shift_id=$1 GROUP BY method ORDER BY method', [shift.id]);
  const refunds = await db.one(`SELECT COALESCE(sum(amount) FILTER (WHERE method='Cash'),0) cash, COALESCE(sum(amount),0) total FROM refunds WHERE shift_id=$1`, [shift.id]);
  const moves = await db.all('SELECT m.*, u.name user_name FROM cash_moves m LEFT JOIN users u ON u.id=m.user_id WHERE shift_id=$1 ORDER BY id', [shift.id]);
  const exp = await db.one(`SELECT COALESCE(sum(amount),0) s FROM expenses WHERE shift_id=$1 AND method='Cash'`, [shift.id]);
  const duepay = await db.one(`SELECT COALESCE(sum(amount),0) s FROM customer_payments WHERE shift_id=$1 AND method='Cash'`, [shift.id]);
  const orders = await db.one(`SELECT count(*)::int n, COALESCE(sum(total),0) total FROM orders WHERE shift_id=$1 AND status='completed'`, [shift.id]);
  const cashSales = num((pays.find(p => p.method === 'Cash') || {}).amount);
  const cin = moves.filter(m => m.type === 'in').reduce((s, m) => s + num(m.amount), 0);
  const cout = moves.filter(m => m.type === 'out').reduce((s, m) => s + num(m.amount), 0);
  const expected = r2(num(shift.opening_cash) + cashSales + num(duepay.s) + cin - cout - num(refunds.cash) - num(exp.s));
  return { shift, payments: pays, refunds, moves, cash_expenses: num(exp.s), due_collected: num(duepay.s), orders, cash_sales: cashSales, cash_in: cin, cash_out: cout, expected_cash: expected };
}
r.get('/shift/current', U(['shifts', 'pos']), wrap(async (req, res) => {
  const s = await db.one(`SELECT s.*, u.name user_name FROM shifts s LEFT JOIN users u ON u.id=s.user_id WHERE s.tenant_id=$1 AND s.user_id=$2 AND s.status='open' ORDER BY id DESC LIMIT 1`, [req.tid, req.user.id]);
  res.json(s ? await shiftReport(req.tid, s) : null);
}));
r.post('/shift/open', U(['shifts', 'pos']), wrap(async (req, res) => {
  const ex = await db.one(`SELECT id FROM shifts WHERE tenant_id=$1 AND user_id=$2 AND status='open'`, [req.tid, req.user.id]);
  if (ex) fail(400, 'You already have an open shift');
  const s = await db.one('INSERT INTO shifts(tenant_id,branch_id,user_id,opening_cash,note) VALUES($1,$2,$3,$4,$5) RETURNING *', [req.tid, req.branchId, req.user.id, num(req.body.opening_cash), str(req.body.note, 300)]);
  await c.audit(req, 'open', 'shift', s.id, { opening_cash: s.opening_cash });
  res.json(s);
}));
r.post('/shift/cash', U(['shifts', 'pos']), wrap(async (req, res) => {
  const s = await db.one(`SELECT id FROM shifts WHERE tenant_id=$1 AND user_id=$2 AND status='open'`, [req.tid, req.user.id]);
  if (!s) fail(400, 'Open a shift first');
  if (!['in', 'out'].includes(req.body.type) || !(num(req.body.amount) > 0)) fail(400, 'Choose cash in/out and an amount');
  await db.q('INSERT INTO cash_moves(tenant_id,shift_id,branch_id,type,amount,note,user_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [req.tid, s.id, req.branchId, req.body.type, num(req.body.amount), str(req.body.note, 300), req.user.id]);
  res.json({ ok: true });
}));
r.post('/shift/close', U(['shifts', 'pos']), wrap(async (req, res) => {
  const s = await db.one(`SELECT * FROM shifts WHERE tenant_id=$1 AND user_id=$2 AND status='open'`, [req.tid, req.user.id]);
  if (!s) fail(400, 'No open shift');
  const rep = await shiftReport(req.tid, s);
  await db.q(`UPDATE shifts SET status='closed', closed_at=now(), closing_cash=$2, expected_cash=$3, note=COALESCE($4,note) WHERE id=$1`, [s.id, num(req.body.closing_cash), rep.expected_cash, str(req.body.note, 300)]);
  await c.audit(req, 'close', 'shift', s.id, { closing_cash: num(req.body.closing_cash), expected: rep.expected_cash });
  res.json(Object.assign(rep, { closing_cash: num(req.body.closing_cash), difference: r2(num(req.body.closing_cash) - rep.expected_cash) }));
}));
r.get('/shifts', U(['shifts', 'accounting', 'reports']), wrap(async (req, res) => {
  res.json(await db.all(`SELECT s.*, u.name user_name, b.name branch_name, (s.closing_cash - s.expected_cash) difference FROM shifts s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN branches b ON b.id=s.branch_id
    WHERE s.tenant_id=$1 AND ($2::int IS NULL OR s.branch_id=$2) ORDER BY s.id DESC LIMIT 200`, [req.tid, req.query.branch === 'all' && !req.user.branch_id ? null : req.branchId]));
}));
r.get('/shifts/:id', U(['shifts', 'accounting', 'reports']), wrap(async (req, res) => {
  const s = await db.one('SELECT s.*, u.name user_name FROM shifts s LEFT JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.tenant_id=$2', [int(req.params.id), req.tid]);
  if (!s) fail(404, 'Not found');
  res.json(await shiftReport(req.tid, s));
}));

// ================= kitchen display =================
r.get('/kds', U(['kitchen', 'pos']), wrap(async (req, res) => {
  const p = [req.tid, req.branchId]; let st = '';
  if (int(req.query.station)) { p.push(int(req.query.station)); st = ` AND i.station_id=$3`; }
  const items = await db.all(`SELECT i.id, i.order_id, i.name, i.variant, i.addons, i.qty, i.note, i.kstatus, i.sent_at, i.started_at, i.ready_at, i.station_id,
      o.order_no, o.type, o.source, o.priority, o.note order_note, o.created_at, o.customer_name, t.name table_name, w.name waiter_name, s.name station_name
    FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN users w ON w.id=o.waiter_id LEFT JOIN stations s ON s.id=i.station_id
    WHERE i.tenant_id=$1 AND o.branch_id=$2 AND o.status NOT IN ('cancelled','rejected','merged','pending')
      AND (i.kstatus IN ('new','preparing') OR (i.kstatus='ready' AND i.ready_at > now() - interval '20 minutes')) ${st}
    ORDER BY o.priority DESC, i.sent_at, i.id`, p);
  const cancelled = await db.all(`SELECT i.name, i.qty, o.order_no, t.name table_name FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN tables t ON t.id=o.table_id
    WHERE i.tenant_id=$1 AND o.branch_id=$2 AND i.kstatus='cancelled' AND i.sent_at IS NOT NULL AND o.updated_at > now() - interval '30 minutes' ORDER BY o.updated_at DESC LIMIT 10`, [req.tid, req.branchId]);
  const stations = await db.all('SELECT id, name FROM stations WHERE tenant_id=$1 AND active ORDER BY id', [req.tid]);
  res.json({ items, cancelled, stations, delay_min: num(req.tenant.settings.kds_delay_min, 15), server_time: new Date().toISOString() });
}));
async function afterKitchenChange(req, orderIds) {
  for (const oid of [...new Set(orderIds)]) {
    const st = await db.one(`SELECT count(*) FILTER (WHERE kstatus IN ('new','preparing'))::int pending, count(*) FILTER (WHERE kstatus='ready')::int ready FROM order_items WHERE order_id=$1 AND kstatus<>'cancelled'`, [oid]);
    if (st.pending === 0 && st.ready > 0) {
      const o = await db.one('SELECT o.*, t.name table_name FROM orders o LEFT JOIN tables t ON t.id=o.table_id WHERE o.id=$1', [oid]);
      await c.notify(req.tid, o.branch_id, 'ready', `Order #${o.order_no} is ready`, o.table_name ? `Table ${o.table_name} — please serve` : (o.type === 'delivery' ? 'Ready for delivery' : 'Ready for pickup'), '#/orders');
      const s = req.tenant.settings;
      if (['online', 'kiosk'].includes(o.source) && o.customer_phone && s.sms_events && s.sms_events.ready)
        c.sendSMS(s, o.customer_phone, `${req.tenant.name}: your order #${o.order_no} is ready${o.type === 'delivery' ? ' and will be on its way soon' : ' for pickup'}.`);
    }
  }
}
const KSTEP = { new: 'new', preparing: 'preparing', ready: 'ready', served: 'served' };
r.post('/kds/items/:id', U(['kitchen', 'pos']), wrap(async (req, res) => {
  const st = KSTEP[req.body.status]; if (!st) fail(400, 'Invalid status');
  const it = await db.one(`UPDATE order_items SET kstatus=$3, started_at=CASE WHEN $3='preparing' THEN COALESCE(started_at, now()) ELSE started_at END,
      ready_at=CASE WHEN $3='ready' THEN now() ELSE ready_at END, served_at=CASE WHEN $3='served' THEN now() ELSE served_at END
    WHERE id=$1 AND tenant_id=$2 AND kstatus<>'cancelled' RETURNING order_id`, [int(req.params.id), req.tid, st]);
  if (!it) fail(404, 'Item not found');
  if (st === 'ready') await afterKitchenChange(req, [it.order_id]);
  res.json({ ok: true });
}));
r.post('/kds/orders/:id', U(['kitchen', 'pos']), wrap(async (req, res) => {
  const st = KSTEP[req.body.status]; if (!st) fail(400, 'Invalid status');
  const p = [int(req.params.id), req.tid, st]; let extra = '';
  if (int(req.body.station)) { p.push(int(req.body.station)); extra = ' AND station_id=$4'; }
  const from = st === 'preparing' ? `('new')` : st === 'ready' ? `('new','preparing')` : `('new','preparing','ready')`;
  await db.q(`UPDATE order_items SET kstatus=$3, started_at=CASE WHEN $3 IN ('preparing','ready') THEN COALESCE(started_at, now()) ELSE started_at END,
      ready_at=CASE WHEN $3='ready' THEN now() ELSE ready_at END, served_at=CASE WHEN $3='served' THEN now() ELSE served_at END
    WHERE order_id=$1 AND tenant_id=$2 AND kstatus IN ${from} ${extra}`, p);
  if (st === 'ready') await afterKitchenChange(req, [int(req.params.id)]);
  res.json({ ok: true });
}));

// ================= tables & QR =================
r.get('/tables/live', U(['tables', 'pos']), wrap(async (req, res) => {
  const floors = await db.all('SELECT id, name FROM floors WHERE tenant_id=$1 AND branch_id=$2 ORDER BY sort, id', [req.tid, req.branchId]);
  const tables = await db.all(`SELECT t.*, w.name waiter_name,
      (SELECT json_agg(json_build_object('id',o.id,'order_no',o.order_no,'total',o.total,'paid',o.paid,'status',o.status,'created_at',o.created_at,'guests',o.guests,
        'ready', (SELECT count(*)::int FROM order_items i WHERE i.order_id=o.id AND i.kstatus='ready')) ORDER BY o.id)
       FROM orders o WHERE o.table_id=t.id AND o.status IN ('open','held','pending')) orders,
      (SELECT json_build_object('id',rv.id,'customer_name',rv.customer_name,'time',rv.time,'guests',rv.guests) FROM reservations rv
        WHERE rv.table_id=t.id AND rv.date=(now() AT TIME ZONE $3)::date AND rv.status IN ('booked','confirmed') ORDER BY rv.time LIMIT 1) reservation
    FROM tables t LEFT JOIN users w ON w.id=t.waiter_id WHERE t.tenant_id=$1 AND t.branch_id=$2 ORDER BY t.name`, [req.tid, req.branchId, tz(req)]);
  tables.forEach(t => { if (t.orders && t.orders.length) t.live_status = 'occupied'; else t.live_status = t.status === 'occupied' ? 'available' : t.status; });
  res.json({ floors, tables });
}));
r.post('/tables/:id/status', U(['tables', 'pos']), wrap(async (req, res) => {
  if (!['available', 'reserved', 'cleaning', 'occupied'].includes(req.body.status)) fail(400, 'Invalid status');
  await db.q('UPDATE tables SET status=$3, status_since=now() WHERE id=$1 AND tenant_id=$2', [int(req.params.id), req.tid, req.body.status]);
  res.json({ ok: true });
}));
r.post('/tables/:id/waiter', U(['tables', 'pos']), wrap(async (req, res) => {
  const w = int(req.body.waiter_id);
  if (w && !(await db.one('SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2', [w, req.tid]))) fail(400, 'Waiter not found');
  await db.q('UPDATE tables SET waiter_id=$3 WHERE id=$1 AND tenant_id=$2', [int(req.params.id), req.tid, w || null]);
  await db.q(`UPDATE orders SET waiter_id=$3 WHERE table_id=$1 AND tenant_id=$2 AND status IN ('open','held')`, [int(req.params.id), req.tid, w || null]);
  res.json({ ok: true });
}));
r.post('/tables/:id/regen-qr', U('tables'), wrap(async (req, res) => {
  await db.q('UPDATE tables SET qr_token=$3 WHERE id=$1 AND tenant_id=$2', [int(req.params.id), req.tid, c.token(10)]); res.json({ ok: true });
}));
r.get('/qr/table/:id', U(['tables', 'settings']), wrap(async (req, res) => {
  const t = await db.one('SELECT qr_token FROM tables WHERE id=$1 AND tenant_id=$2', [int(req.params.id), req.tid]);
  if (!t) fail(404, 'Not found');
  const svg = await QRCode.toString(`${origin(req)}/m/${req.tenant.slug}?t=${t.qr_token}`, { type: 'svg', margin: 1, width: 300 });
  res.setHeader('Content-Type', 'image/svg+xml'); res.end(svg);
}));
r.get('/qr/menu', U(null), wrap(async (req, res) => {
  const url = req.query.kiosk ? `${origin(req)}/m/${req.tenant.slug}?kiosk=1` : `${origin(req)}/m/${req.tenant.slug}${req.query.branch ? '?branch=' + int(req.query.branch) : ''}`;
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 300 });
  res.setHeader('Content-Type', 'image/svg+xml'); res.end(svg);
}));
// High-quality QR download: exact size in mm / cm / in, square. format: png | svg | pdf. target: table (id or 'all' → zip) | menu | kiosk
r.get('/qr/download', U(['tables', 'settings', 'pos']), wrap(async (req, res) => {
  const QR = require('./qr');
  const q = req.query;
  const unit = ['mm', 'cm', 'in'].includes(q.unit) ? q.unit : 'cm';
  const size = Math.max(0.5, Math.min(unit === 'mm' ? 1000 : unit === 'cm' ? 100 : 40, num(q.size, 5)));
  const fmtx = ['png', 'svg', 'pdf'].includes(q.format) ? q.format : 'png';
  const opts = { size, unit, dpi: int(q.dpi, 300), margin: int(q.margin, 2), ecl: String(q.ecl || 'M').toUpperCase(), fg: q.fg, bg: q.bg };
  if (QR.toInches(size, unit) * Math.min(1200, opts.dpi) > 12000 && fmtx === 'png') fail(400, 'This size is too big for PNG at this DPI. Lower the DPI or choose SVG/PDF.');
  const label = `${size}${unit}`;
  const make = (url) => fmtx === 'png' ? QR.png(url, opts).buffer : fmtx === 'svg' ? Buffer.from(QR.svg(url, opts)) : QR.pdf(url, opts);
  const mime = { png: 'image/png', svg: 'image/svg+xml', pdf: 'application/pdf' }[fmtx];
  const safe = s => String(s).replace(/[^\w\-]+/g, '_');
  const send = (buf, name, type) => { res.setHeader('Content-Type', type); res.setHeader('Content-Disposition', `${q.inline ? 'inline' : 'attachment'}; filename="${name}"`); res.end(buf); };
  if (q.target === 'menu' || q.target === 'kiosk') {
    const url = `${origin(req)}/m/${req.tenant.slug}${q.target === 'kiosk' ? '?kiosk=1' : int(q.branch) ? '?branch=' + int(q.branch) : ''}`;
    return send(make(url), `${safe(req.tenant.slug)}-${q.target}-qr-${label}.${fmtx}`, mime);
  }
  if (q.id === 'all') {
    const rows = await db.all('SELECT name, qr_token FROM tables WHERE tenant_id=$1 AND branch_id=$2 ORDER BY name', [req.tid, req.branchId]);
    if (!rows.length) fail(404, 'No tables in this branch');
    const files = rows.map(t => ({ name: `table-${safe(t.name)}-${label}.${fmtx}`, data: make(`${origin(req)}/m/${req.tenant.slug}?t=${t.qr_token}`) }));
    return send(QR.zip(files), `${safe(req.tenant.slug)}-table-qr-codes-${label}.zip`, 'application/zip');
  }
  const t = await db.one('SELECT name, qr_token FROM tables WHERE id=$1 AND tenant_id=$2', [int(q.id), req.tid]);
  if (!t) fail(404, 'Table not found');
  send(make(`${origin(req)}/m/${req.tenant.slug}?t=${t.qr_token}`), `table-${safe(t.name)}-qr-${label}.${fmtx}`, mime);
}));

r.get('/qr/tables', U(['tables', 'settings']), wrap(async (req, res) => {
  const rows = await db.all('SELECT t.id, t.name, t.qr_token, f.name floor_name FROM tables t LEFT JOIN floors f ON f.id=t.floor_id WHERE t.tenant_id=$1 AND t.branch_id=$2 ORDER BY t.name', [req.tid, req.branchId]);
  for (const t of rows) {
    t.url = `${origin(req)}/m/${req.tenant.slug}?t=${t.qr_token}`;
    t.svg = await QRCode.toString(t.url, { type: 'svg', margin: 1, width: 220 });
    delete t.qr_token;
  }
  res.json(rows);
}));

// ================= delivery =================
r.get('/delivery/board', U(['delivery', 'pos']), wrap(async (req, res) => {
  const orders = await db.all(`SELECT o.id, o.order_no, o.status, o.total, o.paid, o.customer_name, o.customer_phone, o.address, o.delivery_status, o.created_at, o.rider_id, o.payment_note, o.source,
      z.name zone_name, rd.name rider_name, (SELECT count(*)::int FROM order_items i WHERE i.order_id=o.id AND i.kstatus IN ('new','preparing')) cooking
    FROM orders o LEFT JOIN zones z ON z.id=o.zone_id LEFT JOIN riders rd ON rd.id=o.rider_id
    WHERE o.tenant_id=$1 AND o.branch_id=$2 AND o.type='delivery' AND o.status NOT IN ('cancelled','rejected','merged')
      AND (COALESCE(o.delivery_status,'') NOT IN ('delivered','failed') OR o.updated_at > now() - interval '12 hours') ORDER BY o.id DESC LIMIT 200`, [req.tid, req.branchId]);
  const riders = await db.all(`SELECT r.*, (SELECT count(*)::int FROM orders o WHERE o.rider_id=r.id AND o.delivery_status IN ('assigned','picked')) active_jobs FROM riders r WHERE r.tenant_id=$1 AND r.branch_id=$2 AND r.active ORDER BY r.name`, [req.tid, req.branchId]);
  res.json({ orders, riders });
}));
r.get('/delivery/riders-report', U(['delivery', 'reports']), wrap(async (req, res) => {
  const from = req.query.from || new Date().toISOString().slice(0, 10), to = req.query.to || from;
  res.json(await db.all(`SELECT r.id, r.name, r.phone, r.per_delivery,
      count(o.id) FILTER (WHERE o.delivery_status='delivered')::int delivered, count(o.id) FILTER (WHERE o.delivery_status='failed')::int failed,
      COALESCE(sum(o.total) FILTER (WHERE o.delivery_status='delivered'),0) order_value,
      COALESCE(sum(p.cash) FILTER (WHERE o.delivery_status='delivered'),0) cash_collected,
      (SELECT COALESCE(sum(amount),0) FROM rider_payments rp WHERE rp.rider_id=r.id AND rp.type='cash deposit' AND rp.date BETWEEN $3 AND $4) cash_deposited,
      (SELECT COALESCE(sum(amount),0) FROM rider_payments rp WHERE rp.rider_id=r.id AND rp.type IN ('payment','advance') AND rp.date BETWEEN $3 AND $4) paid_to_rider,
      ROUND(avg(EXTRACT(EPOCH FROM (o.updated_at - o.created_at))/60) FILTER (WHERE o.delivery_status='delivered'))::int avg_minutes
    FROM riders r LEFT JOIN orders o ON o.rider_id=r.id AND (o.created_at AT TIME ZONE $2)::date BETWEEN $3 AND $4
    LEFT JOIN LATERAL (SELECT COALESCE(sum(amount),0) cash FROM order_payments op WHERE op.order_id=o.id AND op.method='Cash') p ON true
    WHERE r.tenant_id=$1 GROUP BY r.id ORDER BY delivered DESC`, [req.tid, tz(req), from, to]));
}));

// ================= customers =================
r.get('/customers/:id/profile', U(['customers', 'pos']), wrap(async (req, res) => {
  const cu = await db.one('SELECT * FROM customers WHERE id=$1 AND tenant_id=$2', [int(req.params.id), req.tid]);
  if (!cu) fail(404, 'Not found');
  const orders = await db.all(`SELECT id, order_no, type, status, total, paid, created_at FROM orders WHERE customer_id=$1 AND tenant_id=$2 ORDER BY id DESC LIMIT 100`, [cu.id, req.tid]);
  const payments = await db.all('SELECT * FROM customer_payments WHERE customer_id=$1 ORDER BY id DESC', [cu.id]);
  const fav = await db.all(`SELECT i.name, sum(i.qty) qty FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.customer_id=$1 AND o.status='completed' AND i.kstatus<>'cancelled' GROUP BY i.name ORDER BY qty DESC LIMIT 5`, [cu.id]);
  const feedback = await db.all('SELECT * FROM feedback WHERE tenant_id=$1 AND (customer_id=$2 OR (phone IS NOT NULL AND phone=$3)) ORDER BY id DESC', [req.tid, cu.id, cu.phone]);
  res.json({ customer: cu, orders, payments, favourites: fav, feedback });
}));
r.post('/customers/:id/pay-due', U(['customers', 'pos', 'accounting']), wrap(async (req, res) => {
  const amt = num(req.body.amount);
  if (!(amt > 0)) fail(400, 'Enter an amount');
  const shift = await db.one(`SELECT id FROM shifts WHERE tenant_id=$1 AND user_id=$2 AND status='open'`, [req.tid, req.user.id]);
  const cu = await db.one('UPDATE customers SET due=GREATEST(0, due-$3) WHERE id=$1 AND tenant_id=$2 RETURNING *', [int(req.params.id), req.tid, amt]);
  if (!cu) fail(404, 'Not found');
  await db.q('INSERT INTO customer_payments(tenant_id,customer_id,amount,method,note,user_id,shift_id) VALUES($1,$2,$3,$4,$5,$6,$7)', [req.tid, cu.id, amt, str(req.body.method, 30) || 'Cash', str(req.body.note, 300), req.user.id, shift && shift.id]);
  await c.audit(req, 'due-payment', 'customer', cu.id, { amount: amt });
  res.json(cu);
}));
r.post('/customers/:id/points', U('customers'), wrap(async (req, res) => {
  const cu = await db.one('UPDATE customers SET points=GREATEST(0, points+$3) WHERE id=$1 AND tenant_id=$2 RETURNING *', [int(req.params.id), req.tid, num(req.body.points)]);
  if (!cu) fail(404, 'Not found');
  await c.audit(req, 'points', 'customer', cu.id, { points: num(req.body.points), note: req.body.note });
  res.json(cu);
}));

// ================= attendance =================
r.get('/attendance', U(['attendance', 'staff']), wrap(async (req, res) => {
  const date = req.query.date || O.localNow(tz(req)).date;
  const all = c.can(req, 'staff');
  const rows = await db.all(`SELECT u.id user_id, u.name, u.designation, a.id, a.clock_in, a.clock_out, a.note,
      (SELECT json_build_object('start',s.start_time,'end',s.end_time) FROM shift_schedules s WHERE s.user_id=u.id AND s.date=$2 LIMIT 1) schedule,
      (SELECT type FROM leaves l WHERE l.user_id=u.id AND l.status='approved' AND $2 BETWEEN l.from_date AND l.to_date LIMIT 1) on_leave
    FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND a.date=$2 WHERE u.tenant_id=$1 AND u.active ${all ? '' : 'AND u.id=$3'} ORDER BY u.name`,
    all ? [req.tid, date] : [req.tid, date, req.user.id]);
  res.json({ date, rows });
}));
r.post('/attendance/clock', U(['attendance', 'staff']), wrap(async (req, res) => {
  let uid = req.user.id;
  if (req.body.user_id && int(req.body.user_id) !== req.user.id) { if (!c.can(req, 'staff')) fail(403, 'Not allowed'); uid = int(req.body.user_id); }
  if (!(await db.one('SELECT 1 FROM users WHERE id=$1 AND tenant_id=$2', [uid, req.tid]))) fail(404, 'Staff not found');
  const date = O.localNow(tz(req)).date;
  const a = await db.one('SELECT * FROM attendance WHERE tenant_id=$1 AND user_id=$2 AND date=$3', [req.tid, uid, date]);
  let out;
  if (!a) out = await db.one('INSERT INTO attendance(tenant_id,user_id,date,clock_in) VALUES($1,$2,$3,now()) RETURNING *', [req.tid, uid, date]);
  else if (!a.clock_out) out = await db.one('UPDATE attendance SET clock_out=now() WHERE id=$1 RETURNING *', [a.id]);
  else fail(400, 'Already clocked out today');
  res.json(out);
}));
r.put('/attendance/:id', U('staff'), wrap(async (req, res) => {
  const row = await db.one('UPDATE attendance SET clock_in=$3, clock_out=$4, note=$5 WHERE id=$1 AND tenant_id=$2 RETURNING *', [int(req.params.id), req.tid, req.body.clock_in || null, req.body.clock_out || null, str(req.body.note, 300)]);
  if (!row) fail(404, 'Not found');
  await c.audit(req, 'update', 'attendance', row.id); res.json(row);
}));
r.get('/attendance/summary', U('staff'), wrap(async (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : O.localNow(tz(req)).date.slice(0, 7);
  res.json(await db.all(`SELECT u.id, u.name, u.designation, u.salary,
      count(a.id)::int days_present,
      ROUND(COALESCE(sum(EXTRACT(EPOCH FROM (a.clock_out - a.clock_in))/3600),0)::numeric, 2) hours,
      ROUND(COALESCE(sum(GREATEST(0, EXTRACT(EPOCH FROM (a.clock_out - a.clock_in))/3600 - 8)),0)::numeric, 2) overtime_hours,
      (SELECT COALESCE(sum(amount),0) FROM salary_payments s WHERE s.user_id=u.id AND s.month=$2 AND s.type IN ('salary','bonus','overtime')) paid,
      (SELECT COALESCE(sum(amount),0) FROM salary_payments s WHERE s.user_id=u.id AND s.month=$2 AND s.type IN ('advance','deduction')) advances,
      (SELECT COALESCE(sum(to_date - from_date + 1),0)::int FROM leaves l WHERE l.user_id=u.id AND l.status='approved' AND to_char(l.from_date,'YYYY-MM')=$2) leave_days
    FROM users u LEFT JOIN attendance a ON a.user_id=u.id AND to_char(a.date,'YYYY-MM')=$2 WHERE u.tenant_id=$1 GROUP BY u.id ORDER BY u.name`, [req.tid, month]));
}));

module.exports = r;
