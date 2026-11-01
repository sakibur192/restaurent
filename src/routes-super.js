// Super admin (platform owner) API — everything about the SaaS is editable here
const express = require('express');
const db = require('./db');
const c = require('./core');
const { wrap, fail, str, num, int } = c;
const r = express.Router();

r.post('/login', wrap(async (req, res) => {
  c.failGuard('sa:' + req.ip, 8);
  const email = String(req.body.email || '').trim().toLowerCase();
  const a = await db.one('SELECT * FROM super_admins WHERE email=$1 AND active', [email]);
  const ok = a && await c.check(req.body.password || '', a.password_hash);
  await db.q('INSERT INTO login_logs(kind,user_id,username,success,ip,ua) VALUES($1,$2,$3,$4,$5,$6)', ['super', a && a.id, email, !!ok, req.ip, str(req.headers['user-agent'], 300)]);
  if (!ok) { c.failHit('sa:' + req.ip, 30 * 60 * 1000); fail(400, 'Wrong email or password'); }
  await db.q('UPDATE super_admins SET last_login=now() WHERE id=$1', [a.id]);
  await c.createSession(req, res, 'super', a.id);
  res.json({ ok: true });
}));
r.post('/logout', wrap(async (req, res) => { await c.destroySession(req, res, 'super'); res.json({ ok: true }); }));

r.use(c.requireSuper);
r.get('/me', (req, res) => res.json(req.admin));

r.get('/stats', wrap(async (req, res) => {
  const t = await db.one(`SELECT count(*)::int total,
    count(*) FILTER (WHERE status='trial' AND (expires_at IS NULL OR expires_at>now()))::int trial,
    count(*) FILTER (WHERE status='active' AND (expires_at IS NULL OR expires_at>now()))::int active,
    count(*) FILTER (WHERE status='suspended')::int suspended,
    count(*) FILTER (WHERE status<>'suspended' AND expires_at<now())::int expired,
    count(*) FILTER (WHERE created_at > now()-interval '30 days')::int new30,
    count(*) FILTER (WHERE expires_at BETWEEN now() AND now()+interval '7 days')::int expiring7
    FROM tenants`);
  const p = await db.one(`SELECT COALESCE(sum(amount) FILTER (WHERE status='approved'),0) revenue,
    COALESCE(sum(amount) FILTER (WHERE status='approved' AND decided_at > date_trunc('month', now())),0) month_revenue,
    count(*) FILTER (WHERE status='pending')::int pending FROM sub_payments`);
  const o = await db.one(`SELECT count(*)::int orders_today, COALESCE(sum(total),0) gmv_today FROM orders WHERE status='completed' AND completed_at > date_trunc('day', now())`);
  const signups = await db.all(`SELECT to_char(d,'YYYY-MM-DD') AS day, (SELECT count(*)::int FROM tenants WHERE created_at::date=d::date) n
    FROM generate_series(now()-interval '29 days', now(), interval '1 day') d`);
  const recent = await db.all('SELECT id,name,slug,status,created_at,expires_at FROM tenants ORDER BY id DESC LIMIT 8');
  res.json({ tenants: t, payments: p, orders: o, signups, recent });
}));

// ---- tenants ----
r.get('/tenants', wrap(async (req, res) => {
  const params = []; let where = 'WHERE 1=1';
  if (req.query.q) { params.push('%' + req.query.q + '%'); where += ` AND (t.name ILIKE $${params.length} OR t.slug ILIKE $${params.length} OR t.phone ILIKE $${params.length} OR t.email ILIKE $${params.length})`; }
  if (req.query.status === 'expired') where += ` AND t.status<>'suspended' AND t.expires_at<now()`;
  else if (req.query.status) { params.push(req.query.status); where += ` AND t.status=$${params.length} AND (t.status='suspended' OR t.expires_at IS NULL OR t.expires_at>now())`; }
  const rows = await db.all(`SELECT t.id,t.name,t.slug,t.owner_name,t.phone,t.email,t.status,t.expires_at,t.created_at,t.last_active,
      (SELECT count(*)::int FROM users u WHERE u.tenant_id=t.id) users,
      (SELECT count(*)::int FROM branches b WHERE b.tenant_id=t.id) branches,
      (SELECT count(*)::int FROM orders o WHERE o.tenant_id=t.id) orders
    FROM tenants t ${where} ORDER BY t.id DESC LIMIT 500`, params);
  res.json(rows);
}));
r.get('/tenants/:id', wrap(async (req, res) => {
  const id = int(req.params.id);
  const t = await db.one('SELECT * FROM tenants WHERE id=$1', [id]);
  if (!t) fail(404, 'Not found');
  const users = await db.all('SELECT u.id,u.name,u.username,u.phone,u.active,u.last_login,r.name role FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.tenant_id=$1 ORDER BY u.id', [id]);
  const payments = await db.all('SELECT * FROM sub_payments WHERE tenant_id=$1 ORDER BY id DESC', [id]);
  const usage = await db.one(`SELECT (SELECT count(*)::int FROM orders WHERE tenant_id=$1) orders,
    (SELECT COALESCE(sum(total),0) FROM orders WHERE tenant_id=$1 AND status='completed') sales,
    (SELECT count(*)::int FROM products WHERE tenant_id=$1) products,
    (SELECT count(*)::int FROM branches WHERE tenant_id=$1) branches,
    (SELECT count(*)::int FROM customers WHERE tenant_id=$1) customers,
    (SELECT max(created_at) FROM orders WHERE tenant_id=$1) last_order`, [id]);
  res.json({ tenant: t, users, payments, usage });
}));
r.post('/tenants', wrap(async (req, res) => {
  const b = req.body;
  const slug = c.slugify(b.slug || b.name);
  if (!b.name || !slug || !b.username || !b.password) fail(400, 'Name, login ID, username and password are required');
  const { tenant } = await c.createTenant({ name: str(b.name, 120), slug, owner_name: str(b.owner_name, 100) || 'Owner', phone: str(b.phone, 30), email: str(b.email, 120),
    username: String(b.username).trim().toLowerCase(), password: b.password, trial_days: b.days, status: b.status || 'trial', address: str(b.address, 300) }, !!b.demo);
  res.json(tenant);
}));
r.put('/tenants/:id', wrap(async (req, res) => {
  const b = req.body; const id = int(req.params.id);
  const slug = b.slug ? c.slugify(b.slug) : null;
  const row = await db.one(`UPDATE tenants SET name=COALESCE($2,name), slug=COALESCE($3,slug), owner_name=$4, phone=$5, email=$6, address=$7,
      status=COALESCE($8,status), expires_at=COALESCE($9::timestamptz, expires_at), notes=$10 WHERE id=$1 RETURNING *`,
    [id, str(b.name, 120), slug, str(b.owner_name, 100), str(b.phone, 30), str(b.email, 120), str(b.address, 300),
      ['trial', 'active', 'suspended', 'expired'].includes(b.status) ? b.status : null, b.expires_at || null, str(b.notes, 2000)]);
  if (!row) fail(404, 'Not found');
  if (row.status === 'expired' && row.expires_at && new Date(row.expires_at) > new Date()) await db.q(`UPDATE tenants SET status='active' WHERE id=$1`, [id]);
  res.json(row);
}));
r.post('/tenants/:id/extend', wrap(async (req, res) => {
  const days = int(req.body.days, 30);
  const row = await db.one(`UPDATE tenants SET expires_at = GREATEST(COALESCE(expires_at, now()), now()) + ($2 || ' days')::interval,
    status = CASE WHEN status='suspended' THEN status ELSE 'active' END WHERE id=$1 RETURNING *`, [int(req.params.id), String(days)]);
  res.json(row);
}));
r.post('/tenants/:id/reset-password', wrap(async (req, res) => {
  const tid = int(req.params.id);
  if (!req.body.password || String(req.body.password).length < 6) fail(400, 'Password must be at least 6 characters');
  let uid = int(req.body.user_id);
  if (!uid) { const o = await db.one('SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.tenant_id=$1 AND r.is_owner ORDER BY u.id LIMIT 1', [tid]); uid = o && o.id; }
  const u = await db.one('UPDATE users SET password_hash=$3, active=true WHERE id=$1 AND tenant_id=$2 RETURNING id, username', [uid, tid, await c.hash(req.body.password)]);
  if (!u) fail(404, 'User not found');
  await db.q(`DELETE FROM sessions WHERE kind='user' AND user_id=$1`, [u.id]);
  res.json(u);
}));
r.post('/tenants/:id/impersonate', wrap(async (req, res) => {
  const tid = int(req.params.id);
  const o = await db.one('SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id WHERE u.tenant_id=$1 AND r.is_owner AND u.active ORDER BY u.id LIMIT 1', [tid]);
  if (!o) fail(404, 'No active owner user');
  await c.createSession(req, res, 'user', o.id, tid, null, true);
  res.json({ ok: true, url: '/app' });
}));
r.delete('/tenants/:id', wrap(async (req, res) => {
  const t = await db.one('SELECT slug FROM tenants WHERE id=$1', [int(req.params.id)]);
  if (!t) fail(404, 'Not found');
  if (req.body.confirm !== t.slug) fail(400, 'Type the restaurant login ID to confirm deletion');
  await db.q(`DELETE FROM sessions WHERE tenant_id=$1`, [int(req.params.id)]);
  await db.q(`DELETE FROM files WHERE tenant_id=$1`, [int(req.params.id)]);
  await db.q('DELETE FROM tenants WHERE id=$1', [int(req.params.id)]);
  res.json({ ok: true });
}));
r.get('/tenants/:id/export', wrap(async (req, res) => {
  const data = await dumpTenant(int(req.params.id));
  res.setHeader('Content-Disposition', `attachment; filename="tenant-${req.params.id}.json"`);
  res.json(data);
}));

// ---- subscription payments ----
r.get('/payments', wrap(async (req, res) => {
  const params = []; let where = '';
  if (req.query.status) { params.push(req.query.status); where = 'WHERE p.status=$1'; }
  res.json(await db.all(`SELECT p.*, t.name tenant_name, t.slug FROM sub_payments p JOIN tenants t ON t.id=p.tenant_id ${where} ORDER BY p.id DESC LIMIT 500`, params));
}));
r.post('/payments', wrap(async (req, res) => { // manual entry (cash, bank) — approved immediately
  const b = req.body; const s = await c.getSettings();
  const days = int(b.days, s.plan.duration_days || 30);
  const p = await db.one(`INSERT INTO sub_payments(tenant_id,amount,method,trx_id,days,status,note,decided_at) VALUES($1,$2,$3,$4,$5,'approved',$6,now()) RETURNING *`,
    [int(b.tenant_id), num(b.amount), str(b.method, 40) || 'Cash', str(b.trx_id, 80), days, str(b.note, 300)]);
  await db.q(`UPDATE tenants SET expires_at = GREATEST(COALESCE(expires_at, now()), now()) + ($2 || ' days')::interval, status=CASE WHEN status='suspended' THEN status ELSE 'active' END WHERE id=$1`, [p.tenant_id, String(days)]);
  res.json(p);
}));
r.post('/payments/:id/:action(approve|reject)', wrap(async (req, res) => {
  const p = await db.one(`SELECT * FROM sub_payments WHERE id=$1`, [int(req.params.id)]);
  if (!p || p.status !== 'pending') fail(400, 'Payment is not pending');
  if (req.params.action === 'approve') {
    const days = int(req.body.days, p.days || 30);
    await db.q(`UPDATE sub_payments SET status='approved', days=$2, decided_at=now(), note=COALESCE($3,note) WHERE id=$1`, [p.id, days, str(req.body.note, 300)]);
    await db.q(`UPDATE tenants SET expires_at = GREATEST(COALESCE(expires_at, now()), now()) + ($2 || ' days')::interval, status=CASE WHEN status='suspended' THEN status ELSE 'active' END WHERE id=$1`, [p.tenant_id, String(days)]);
    await c.notify(p.tenant_id, null, 'billing', 'Payment approved', `Your subscription was extended by ${days} days. Thank you!`, '#/billing');
  } else {
    await db.q(`UPDATE sub_payments SET status='rejected', decided_at=now(), note=COALESCE($2,note) WHERE id=$1`, [p.id, str(req.body.note, 300)]);
    await c.notify(p.tenant_id, null, 'billing', 'Payment rejected', str(req.body.note, 300) || 'Please check the transaction ID and submit again.', '#/billing');
  }
  res.json({ ok: true });
}));

// ---- platform settings (brand, plan, payment, landing, signup) ----
r.get('/settings', wrap(async (req, res) => { c.clearSettingsCache(); res.json(await c.getSettings()); }));
r.put('/settings', wrap(async (req, res) => {
  const allowed = ['brand', 'plan', 'payment', 'landing', 'signup_enabled', 'seo', 'default_lang'];
  for (const k of allowed) if (req.body[k] !== undefined) {
    await db.q(`INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2`, [k, JSON.stringify(req.body[k])]);
  }
  c.clearSettingsCache();
  res.json(await c.getSettings());
}));
r.post('/upload', wrap(async (req, res) => {
  const f = await saveImage(null, req.body.data);
  res.json({ id: f });
}));

// ---- downloads (PDF manuals / brochures shown on the landing page) ----
r.get('/downloads', wrap(async (req, res) => res.json(await db.all('SELECT * FROM downloads ORDER BY sort, id'))));
r.post('/downloads/upload', express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: '60mb' }), wrap(async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100) fail(400, 'Please choose a PDF file');
  if (buf.slice(0, 5).toString() !== '%PDF-') fail(400, 'Only PDF files can be uploaded');
  const f = await db.one('INSERT INTO files(tenant_id,mime,data) VALUES(NULL,$1,$2) RETURNING id', ['application/pdf', buf]);
  const q = req.query;
  const filename = (str(q.filename, 120) || 'document.pdf').replace(/[^\w.\- ]+/g, '_');
  let row;
  if (int(q.id)) {
    const old = await db.one('SELECT file_id FROM downloads WHERE id=$1', [int(q.id)]);
    if (!old) fail(404, 'Not found');
    row = await db.one('UPDATE downloads SET file_id=$2, filename=$3, size=$4 WHERE id=$1 RETURNING *', [int(q.id), f.id, filename, buf.length]);
    if (old.file_id) await db.q('DELETE FROM files WHERE id=$1 AND tenant_id IS NULL', [old.file_id]);
  } else {
    row = await db.one(`INSERT INTO downloads(kind,lang,title_en,title_bn,file_id,filename,size,sort) VALUES($1,$2,$3,$4,$5,$6,$7,(SELECT COALESCE(max(sort),0)+1 FROM downloads)) RETURNING *`,
      [['manual', 'brochure', 'other'].includes(q.kind) ? q.kind : 'manual', ['en', 'bn', 'both'].includes(q.lang) ? q.lang : 'en', str(q.title_en, 200) || filename, str(q.title_bn, 200) || filename, f.id, filename, buf.length]);
  }
  res.json(row);
}));
r.put('/downloads/:id', wrap(async (req, res) => {
  const b = req.body;
  const row = await db.one('UPDATE downloads SET kind=$2, lang=$3, title_en=$4, title_bn=$5, desc_en=$6, desc_bn=$7, sort=$8, active=$9 WHERE id=$1 RETURNING *',
    [int(req.params.id), ['manual', 'brochure', 'other'].includes(b.kind) ? b.kind : 'manual', ['en', 'bn', 'both'].includes(b.lang) ? b.lang : 'en', str(b.title_en, 200), str(b.title_bn, 200), str(b.desc_en, 500), str(b.desc_bn, 500), int(b.sort, 0), b.active !== false]);
  if (!row) fail(404, 'Not found');
  res.json(row);
}));
r.delete('/downloads/:id', wrap(async (req, res) => {
  const row = await db.one('DELETE FROM downloads WHERE id=$1 RETURNING file_id', [int(req.params.id)]);
  if (row && row.file_id) await db.q('DELETE FROM files WHERE id=$1 AND tenant_id IS NULL', [row.file_id]);
  res.json({ ok: true });
}));

// ---- announcements ----
r.get('/announcements', wrap(async (req, res) => res.json(await db.all('SELECT * FROM announcements ORDER BY id DESC'))));
r.post('/announcements', wrap(async (req, res) => {
  const b = req.body;
  res.json(await db.one('INSERT INTO announcements(title,body,level,active) VALUES($1,$2,$3,$4) RETURNING *', [str(b.title, 200), str(b.body, 2000), str(b.level, 20) || 'info', b.active !== false]));
}));
r.put('/announcements/:id', wrap(async (req, res) => {
  const b = req.body;
  res.json(await db.one('UPDATE announcements SET title=$2, body=$3, level=$4, active=$5 WHERE id=$1 RETURNING *', [int(req.params.id), str(b.title, 200), str(b.body, 2000), str(b.level, 20) || 'info', !!b.active]));
}));
r.delete('/announcements/:id', wrap(async (req, res) => { await db.q('DELETE FROM announcements WHERE id=$1', [int(req.params.id)]); res.json({ ok: true }); }));

// ---- super admins ----
r.get('/admins', wrap(async (req, res) => res.json(await db.all('SELECT id,name,email,active,last_login,created_at FROM super_admins ORDER BY id'))));
r.post('/admins', wrap(async (req, res) => {
  const b = req.body;
  if (!b.email || !b.password || String(b.password).length < 6) fail(400, 'Email and a 6+ character password are required');
  res.json(await db.one('INSERT INTO super_admins(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email', [str(b.name, 100), String(b.email).trim().toLowerCase(), await c.hash(b.password)]));
}));
r.put('/admins/:id', wrap(async (req, res) => {
  const b = req.body; const id = int(req.params.id);
  if (id === req.admin.id && b.active === false) fail(400, 'You cannot disable yourself');
  await db.q('UPDATE super_admins SET name=COALESCE($2,name), email=COALESCE($3,email), active=COALESCE($4,active) WHERE id=$1', [id, str(b.name, 100), b.email ? String(b.email).trim().toLowerCase() : null, typeof b.active === 'boolean' ? b.active : null]);
  if (b.password) {
    if (String(b.password).length < 6) fail(400, 'Password must be at least 6 characters');
    await db.q('UPDATE super_admins SET password_hash=$2 WHERE id=$1', [id, await c.hash(b.password)]);
  }
  res.json({ ok: true });
}));
r.delete('/admins/:id', wrap(async (req, res) => {
  if (int(req.params.id) === req.admin.id) fail(400, 'You cannot delete yourself');
  await db.q('DELETE FROM super_admins WHERE id=$1', [int(req.params.id)]); res.json({ ok: true });
}));

r.get('/logins', wrap(async (req, res) => {
  res.json(await db.all(`SELECT l.*, t.name tenant_name FROM login_logs l LEFT JOIN tenants t ON t.id=l.tenant_id ORDER BY l.id DESC LIMIT 300`));
}));
r.get('/backup', wrap(async (req, res) => {
  const dump = await dumpAll();
  res.setHeader('Content-Disposition', `attachment; filename="baybex-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(dump);
}));

// ---- helpers ----
async function saveImage(tid, dataUrl) {
  const m = /^data:(image\/(png|jpe?g|webp|gif));base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) fail(400, 'Please upload a PNG, JPG or WEBP image');
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 3 * 1024 * 1024) fail(400, 'Image must be under 3 MB');
  const f = await db.one('INSERT INTO files(tenant_id,mime,data) VALUES($1,$2,$3) RETURNING id', [tid, m[1], buf]);
  return f.id;
}
const TENANT_TABLES = ['branches', 'roles', 'users', 'stations', 'categories', 'products', 'ingredients', 'stock', 'stock_moves', 'recipes', 'recipe_versions', 'suppliers', 'purchases', 'purchase_items',
  'supplier_payments', 'customers', 'customer_payments', 'feedback', 'floors', 'tables', 'riders', 'rider_payments', 'zones', 'coupons', 'shifts', 'cash_moves', 'orders', 'order_items',
  'order_payments', 'refunds', 'attendance', 'leaves', 'salary_payments', 'shift_schedules', 'accounts', 'expense_categories', 'expenses', 'incomes', 'journals', 'period_closings', 'reservations'];
async function dumpTenant(tid) {
  const out = { tenant: await db.one('SELECT * FROM tenants WHERE id=$1', [tid]), exported_at: new Date().toISOString() };
  for (const t of TENANT_TABLES) {
    out[t] = await db.all(`SELECT * FROM ${t} WHERE tenant_id=$1`, [tid]);
    if (t === 'users') out[t].forEach(u => { delete u.password_hash; delete u.pin_hash; });
  }
  return out;
}
async function dumpAll() {
  const out = { exported_at: new Date().toISOString() };
  for (const t of ['settings', 'super_admins', 'tenants', 'sub_payments', 'announcements', ...TENANT_TABLES]) out[t] = await db.all(`SELECT * FROM ${t}`);
  return out;
}

module.exports = r;
module.exports.dumpAll = dumpAll;
module.exports.dumpTenant = dumpTenant;
module.exports.saveImage = saveImage;
