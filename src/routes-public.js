// Public API: platform info, signup, staff login, QR / online ordering, order tracking, menu board
const express = require('express');
const db = require('./db');
const c = require('./core');
const O = require('./orders');
const { wrap, fail, str, num, int } = c;
const r = express.Router();

r.get('/public/site', wrap(async (req, res) => {
  const s = await c.getSettings();
  const ann = await db.all('SELECT title, body, level FROM announcements WHERE active ORDER BY id DESC LIMIT 3');
  res.json({ brand: s.brand, plan: Object.assign({}, s.plan, { periods: s.plan.periods.filter(x => x.active !== false) }), landing: s.landing, default_lang: s.default_lang, signup_enabled: s.signup_enabled !== false, seo: s.seo, payment: { methods: s.payment.methods }, announcements: ann });
}));

r.get('/public/downloads', wrap(async (req, res) => {
  res.json(await db.all('SELECT id, kind, lang, title_en, title_bn, desc_en, desc_bn, filename, size, hits FROM downloads WHERE active AND file_id IS NOT NULL ORDER BY sort, id'));
}));

r.get('/public/slug-check', wrap(async (req, res) => {
  const slug = c.slugify(req.query.slug);
  const ex = slug ? await db.one('SELECT 1 FROM tenants WHERE slug=$1', [slug]) : null;
  res.json({ slug, available: !!slug && !ex && slug.length >= 3 });
}));

r.post('/public/signup', wrap(async (req, res) => {
  c.rateLimit('signup:' + req.ip, 10, 60 * 60 * 1000);
  const s = await c.getSettings();
  if (s.signup_enabled === false) fail(400, 'New signups are closed right now. Please contact us.');
  const b = req.body || {};
  const slug = c.slugify(b.slug || b.name);
  if (!b.name || !b.owner_name || !b.phone) fail(400, 'Restaurant name, your name and phone are required');
  if (!slug || slug.length < 3) fail(400, 'Choose a restaurant login ID with at least 3 letters/numbers');
  if (['admin', 'app', 'api', 'www', 'login', 'signup', 'setup', 'support'].includes(slug)) fail(400, 'This login ID is reserved, choose another');
  if (await db.one('SELECT 1 FROM tenants WHERE slug=$1', [slug])) fail(400, 'This restaurant login ID is taken, choose another');
  const username = String(b.username || 'owner').trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
  if (!username) fail(400, 'Choose a username');
  if (!b.password || String(b.password).length < 6) fail(400, 'Password must be at least 6 characters');
  if (b.pin && !/^\d{4,6}$/.test(String(b.pin))) fail(400, 'PIN must be 4 to 6 digits');
  const { tenant, ownerId, branchId } = await c.createTenant({
    name: str(b.name, 120), slug, owner_name: str(b.owner_name, 100), phone: str(b.phone, 30), email: str(b.email, 120), address: str(b.address, 300),
    username, password: b.password, pin: b.pin
  }, b.demo !== false);
  await c.createSession(req, res, 'user', ownerId, tenant.id, branchId);
  res.json({ ok: true, slug, url: '/app' });
}));

// ---- staff login (password or quick PIN) ----
r.post('/auth/login', wrap(async (req, res) => {
  const b = req.body || {};
  const slug = c.slugify(b.slug);
  c.failGuard('login:' + slug + ':' + req.ip, 10);
  c.failGuard('login:' + slug, 50);
  const t = await db.one('SELECT id, status FROM tenants WHERE slug=$1', [slug]);
  if (!t) fail(400, 'Restaurant ID not found');
  let user = null;
  if (b.pin) {
    const users = await db.all('SELECT * FROM users WHERE tenant_id=$1 AND active AND pin_hash IS NOT NULL', [t.id]);
    for (const u of users) if (await c.check(String(b.pin), u.pin_hash)) { user = u; break; }
  } else {
    const u = await db.one('SELECT * FROM users WHERE tenant_id=$1 AND username=$2', [t.id, String(b.username || '').trim().toLowerCase()]);
    if (u && u.active && await c.check(b.password || '', u.password_hash)) user = u;
  }
  await db.q('INSERT INTO login_logs(kind,tenant_id,user_id,username,success,ip,ua) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [b.pin ? 'pin' : 'user', t.id, user && user.id, user ? user.username : str(b.username, 60), !!user, req.ip, str(req.headers['user-agent'], 300)]);
  if (!user) { c.failHit('login:' + slug + ':' + req.ip); c.failHit('login:' + slug); fail(400, b.pin ? 'Wrong PIN' : 'Wrong username or password'); }
  await db.q('UPDATE users SET last_login=now() WHERE id=$1', [user.id]);
  await c.createSession(req, res, 'user', user.id, t.id, user.branch_id);
  res.json({ ok: true, url: '/app' });
}));
r.post('/auth/logout', wrap(async (req, res) => { await c.destroySession(req, res, 'user'); res.json({ ok: true }); }));

// ---- public menu (QR table, online ordering, kiosk, board) ----
async function loadTenant(slug) {
  const t = await db.one('SELECT id, name, slug, status, expires_at, settings, phone, address FROM tenants WHERE slug=$1', [c.slugify(slug)]);
  if (!t) fail(404, 'Restaurant not found');
  const live = t.status !== 'suspended' && !(t.expires_at && new Date(t.expires_at) < new Date());
  t.settings = Object.assign({}, c.TENANT_DEFAULTS, t.settings || {});
  return { t, live };
}
r.get('/public/menu/:slug', wrap(async (req, res) => {
  const { t, live } = await loadTenant(req.params.slug);
  const s = t.settings;
  let table = null, branchId = int(req.query.branch);
  if (req.query.t) {
    table = await db.one('SELECT id, name, branch_id FROM tables WHERE qr_token=$1 AND tenant_id=$2', [String(req.query.t), t.id]);
    if (table) branchId = table.branch_id;
  }
  const branches = await db.all('SELECT id, name, address, phone FROM branches WHERE tenant_id=$1 AND active AND online_ordering ORDER BY id', [t.id]);
  if (!branchId || !branches.find(b => b.id === branchId)) branchId = branches[0] ? branches[0].id : null;
  const now = O.localNow(s.timezone);
  const cats = await db.all('SELECT id, name, image_id FROM categories WHERE tenant_id=$1 AND active ORDER BY sort, id', [t.id]);
  const prods = (await db.all('SELECT * FROM products WHERE tenant_id=$1 ORDER BY sort, name', [t.id]))
    .filter(p => O.productVisible(p, branchId, now))
    .map(p => ({ id: p.id, category_id: p.category_id, name: p.name, description: p.description, price: O.effectivePrice(p, branchId, now), regular_price: num(p.price), image_id: p.image_id, variants: p.variants, addons: p.addons, by_weight: p.by_weight }));
  const zones = await db.all('SELECT id, name, charge, min_order FROM zones WHERE tenant_id=$1 AND active ORDER BY id', [t.id]);
  res.json({
    restaurant: { name: t.name, slug: t.slug, phone: s.phone || t.phone, address: s.address || t.address, logo_id: s.logo_id, color: s.color, banner: s.banner, theme: s.menu_theme || { preset: 'classic' }, lang: s.menu_lang || 'bn' },
    ordering: live && s.online_ordering !== false, table, branch_id: branchId, branches, categories: cats, products: prods, zones,
    settings: { currency: s.currency, vat_pct: s.vat_pct, vat_inclusive: s.vat_inclusive, service_pct: s.service_pct, service_dine_in_only: s.service_dine_in_only, min_order: s.min_order, round_total: s.round_total, online_payment_note: s.online_payment_note, payment_methods: (s.payment_methods || []).filter(m => m !== 'Due') }
  });
}));

r.post('/public/order/:slug', wrap(async (req, res) => {
  c.rateLimit('porder:' + req.params.slug + ':' + req.ip, 60, 10 * 60 * 1000);
  const { t, live } = await loadTenant(req.params.slug);
  if (!live || t.settings.online_ordering === false) fail(400, 'Online ordering is not available right now');
  const b = req.body || {};
  let table = null, branchId = int(b.branch_id);
  if (b.table_token) {
    table = await db.one('SELECT id, name, branch_id FROM tables WHERE qr_token=$1 AND tenant_id=$2', [String(b.table_token), t.id]);
    if (!table) fail(400, 'Table QR code is not valid');
    branchId = table.branch_id;
  }
  const br = await db.one('SELECT id FROM branches WHERE tenant_id=$1 AND active AND ($2::int IS NULL OR id=$2) ORDER BY id LIMIT 1', [t.id, branchId || null]);
  if (!br) fail(400, 'Branch not available');
  const kiosk = !!b.kiosk;
  const type = table ? 'dine_in' : (b.type === 'delivery' ? 'delivery' : 'takeaway');
  if (!table && !kiosk && (!b.customer_name || !b.customer_phone)) fail(400, 'Please enter your name and phone number');
  if (type === 'delivery' && !b.address) fail(400, 'Please enter the delivery address');
  if (b.customer_phone && !/^[0-9+\-\s]{6,20}$/.test(String(b.customer_phone))) fail(400, 'Phone number is not valid');
  const ctx = { tid: t.id, branchId: br.id, userId: null, settings: t.settings, perms: [], source: table ? 'qr' : kiosk ? 'kiosk' : 'online' };
  const autoAccept = !!t.settings.auto_accept_online || kiosk;
  const out = await db.tx(async tx => {
    const { order } = await O.saveOrder(tx, ctx, {
      type, table_id: table && table.id, customer_name: b.customer_name, customer_phone: b.customer_phone, address: b.address, zone_id: b.zone_id,
      note: [b.note, b.payment_method ? `Payment: ${b.payment_method}` : '', b.trx_id ? `TrxID: ${b.trx_id}` : ''].filter(Boolean).join(' | '),
      items: (b.items || []).map(i => ({ product_id: i.product_id, variant: i.variant, addons: i.addons, qty: i.qty, note: i.note })),
      coupon_code: b.coupon_code || null, scheduled_at: b.scheduled_at || null, source: ctx.source, min_order_check: !table && !kiosk
    });
    if (autoAccept) await O.sendToKitchen(tx, ctx, order.id);
    else await tx.q(`UPDATE orders SET status='pending' WHERE id=$1`, [order.id]);
    if (b.payment_method) await tx.q('UPDATE orders SET payment_note=$2 WHERE id=$1', [order.id, str(`${b.payment_method}${b.trx_id ? ' TrxID ' + b.trx_id : ''}`, 120)]);
    return order;
  });
  await c.notify(t.id, br.id, 'online', `New ${ctx.source === 'qr' ? 'QR table' : ctx.source} order #${out.order_no}`,
    `${table ? 'Table ' + table.name : (b.customer_name || 'Kiosk')} — ${t.settings.currency}${out.total}${autoAccept ? '' : ' (needs accept)'}`, '#/orders?tab=online');
  res.json({ ok: true, order_no: out.order_no, track: out.track_token, total: out.total });
}));

r.get('/public/track/:token', wrap(async (req, res) => {
  let o = await db.one('SELECT * FROM orders WHERE track_token=$1', [String(req.params.token)]);
  if (!o) fail(404, 'Order not found');
  const ownNo = o.order_no;
  if (o.merged_into) o = await db.one('SELECT * FROM orders WHERE id=$1', [o.merged_into]) || o;
  const t = await db.one('SELECT name, slug, settings FROM tenants WHERE id=$1', [o.tenant_id]);
  const items = await db.all(`SELECT name, variant, qty, total, kstatus FROM order_items WHERE order_id=$1 AND kstatus<>'cancelled' ORDER BY id`, [o.id]);
  const tb = o.table_id ? await db.one('SELECT name FROM tables WHERE id=$1', [o.table_id]) : null;
  const rider = o.rider_id ? await db.one('SELECT name, phone FROM riders WHERE id=$1', [o.rider_id]) : null;
  res.json({
    restaurant: { name: t.name, slug: t.slug, currency: (t.settings || {}).currency || '৳', phone: (t.settings || {}).phone, lang: (t.settings || {}).menu_lang || 'bn', theme: (t.settings || {}).menu_theme || null },
    order: { order_no: ownNo, status: o.status, type: o.type, table: tb && tb.name, delivery_status: o.delivery_status, total: o.total, subtotal: o.subtotal, vat: o.vat, service_charge: o.service_charge, delivery_charge: o.delivery_charge, discount: o.discount, created_at: o.created_at, rider },
    items
  });
}));

r.post('/public/feedback/:slug', wrap(async (req, res) => {
  c.rateLimit('fb:' + req.ip, 10, 60 * 60 * 1000);
  const { t } = await loadTenant(req.params.slug);
  const b = req.body || {};
  if (!b.message && !b.rating) fail(400, 'Write a message or choose a rating');
  await db.q('INSERT INTO feedback(tenant_id,customer_name,phone,rating,type,message,order_no) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [t.id, str(b.name, 100), str(b.phone, 30), Math.min(5, Math.max(0, int(b.rating, 0))), b.type === 'complaint' ? 'complaint' : 'feedback', str(b.message, 2000), int(b.order_no)]);
  await c.notify(t.id, null, 'feedback', b.type === 'complaint' ? 'New complaint' : 'New feedback', str(b.message, 200) || `Rating: ${b.rating}/5`, '#/customers?tab=feedback');
  res.json({ ok: true });
}));

module.exports = r;
