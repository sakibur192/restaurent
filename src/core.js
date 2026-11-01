// Core helpers: sessions, auth, permissions, audit, notifications, tenant creation
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('../config');

const PERMS = {
  pos: 'POS & billing', orders: 'View orders', discount: 'Give discounts', void: 'Void / cancel orders', refund: 'Refunds',
  shifts: 'Cash shifts & drawer', tables: 'Tables & floor', kitchen: 'Kitchen display', menu: 'Menu & products',
  inventory: 'Inventory & stock', recipes: 'Recipes & food cost', purchases: 'Purchases', suppliers: 'Suppliers',
  customers: 'Customers & feedback', coupons: 'Offers & coupons', delivery: 'Delivery & riders', reservations: 'Reservations',
  staff: 'Staff, payroll & leaves', attendance: 'Clock in / out', accounting: 'Accounting', reports: 'Reports',
  branches: 'Branches', settings: 'Settings, users & roles'
};
const DEFAULT_ROLES = [
  { key: 'owner', name: 'Owner', is_owner: true, perms: Object.keys(PERMS) },
  { key: 'manager', name: 'Branch Manager', perms: ['pos', 'orders', 'discount', 'void', 'refund', 'shifts', 'tables', 'kitchen', 'menu', 'inventory', 'recipes', 'purchases', 'suppliers', 'customers', 'coupons', 'delivery', 'reservations', 'staff', 'attendance', 'reports'] },
  { key: 'cashier', name: 'Cashier', perms: ['pos', 'orders', 'discount', 'shifts', 'tables', 'customers', 'delivery', 'reservations', 'attendance'] },
  { key: 'waiter', name: 'Waiter', perms: ['pos', 'orders', 'tables', 'reservations', 'attendance'] },
  { key: 'kitchen', name: 'Kitchen / Chef', perms: ['kitchen', 'attendance'] },
  { key: 'accountant', name: 'Accountant', perms: ['orders', 'accounting', 'reports', 'purchases', 'suppliers', 'attendance'] }
];
const TENANT_DEFAULTS = {
  currency: '৳', vat_pct: 5, vat_inclusive: false, service_pct: 0, service_dine_in_only: true, round_total: true,
  bin: '', receipt_header: '', receipt_footer: 'Thank you! Please come again.', receipt_width: 80,
  payment_methods: ['Cash', 'Card', 'bKash', 'Nagad', 'Rocket', 'Due'],
  order_sources: ['Walk-in', 'Phone', 'Foodpanda', 'Pathao Food', 'Facebook'],
  loyalty_enabled: true, points_per_amount: 100, point_value: 1, kds_enabled: true, table_cleaning: false,
  online_ordering: true, auto_accept_online: false, min_order: 0, banner: '', timezone: 'Asia/Dhaka', kds_delay_min: 15,
  sms_url: '', sms_events: { online_accept: true, ready: true, reservation: true }, logo_id: null,
  approval_discount_pct: 0, online_payment_note: 'Pay on delivery, or send bKash/Nagad and enter the TrxID.',
  menu_theme: { preset: 'classic' }, menu_lang: 'bn', ui_lang: 'en', cover_id: null
};

// ---- small utils ----
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const int = (v, d = null) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const token = (n = 24) => crypto.randomBytes(n).toString('hex');
const str = (v, max = 500) => (v === undefined || v === null ? null : String(v).trim().slice(0, max));
const hash = p => bcrypt.hash(String(p), 10);
const check = (p, h) => (h ? bcrypt.compare(String(p), h) : Promise.resolve(false));
class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }
const fail = (status, msg, code) => { throw new HttpError(status, msg, code); };
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setCookie(req, res, name, val, days) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [`${name}=${encodeURIComponent(val)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.round(days * 86400)}`];
  if (secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [].concat(prev || [], parts.join('; ')));
}

// ---- rate limit (login) ----
const hits = new Map();
function rateLimit(key, max = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now(); let h = hits.get(key);
  if (!h || h.reset < now) { h = { c: 0, reset: now + windowMs }; hits.set(key, h); }
  h.c++;
  if (h.c > max) fail(429, 'Too many attempts. Please wait a few minutes and try again.');
}
// failed-attempt limiter: check before, record only failures (shared IPs / CGNAT stay usable)
function failGuard(key, max = 10) { const h = hits.get(key); if (h && h.reset > Date.now() && h.c >= max) fail(429, 'Too many wrong attempts. Please wait 10 minutes and try again.'); }
function failHit(key, windowMs = 10 * 60 * 1000) { const now = Date.now(); let h = hits.get(key); if (!h || h.reset < now) { h = { c: 0, reset: now + windowMs }; hits.set(key, h); } h.c++; }
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, 60000).unref();

// ---- global settings cache ----
let settingsCache = null, settingsAt = 0;
async function getSettings() {
  if (settingsCache && Date.now() - settingsAt < 30000) return settingsCache;
  const rows = await db.all('SELECT key, value FROM settings');
  const s = JSON.parse(JSON.stringify(db.DEFAULT_SETTINGS));
  rows.forEach(r => { s[r.key] = r.value; });
  normalizeSettings(s);
  settingsCache = s; settingsAt = Date.now(); return s;
}
function clearSettingsCache() { settingsCache = null; }
// upgrade older saved settings to the current shape
function normalizeSettings(s) {
  const D = db.DEFAULT_SETTINGS;
  const p = s.plan || {};
  if (!Array.isArray(p.periods) || !p.periods.length) {
    p.periods = JSON.parse(JSON.stringify(D.plan.periods));
    if (p.price) { p.periods[0].price = Number(p.price); p.periods[0].days = Number(p.duration_days) || 30; }
    if (p.yearly_price) p.periods[3].price = Number(p.yearly_price);
  }
  ['name_bn', 'note_bn', 'features_bn'].forEach(k => { if (p[k] === undefined) p[k] = JSON.parse(JSON.stringify(D.plan[k])); });
  if (!p.trial_days && p.trial_days !== 0) p.trial_days = D.plan.trial_days;
  const act = p.periods.filter(x => x.active !== false);
  const first = act[0] || p.periods[0];
  p.price = Number(first.price); p.duration_days = Number(first.days) || 30;   // kept for older screens
  s.plan = p;
  let L = s.landing || {};
  if (!L.en || !L.bn) L = { en: Object.assign({}, D.landing.en, L.hero_title ? { hero_title: L.hero_title, hero_highlight: '', hero_sub: L.hero_sub, cta_primary: L.cta || D.landing.en.cta_primary } : {}), bn: D.landing.bn };
  for (const lang of ['en', 'bn']) for (const k of Object.keys(D.landing[lang])) if (L[lang][k] === undefined) L[lang][k] = JSON.parse(JSON.stringify(D.landing[lang][k]));
  s.landing = L;
  if (!s.default_lang) s.default_lang = 'bn';
  if (s.payment && s.payment.instructions_bn === undefined) s.payment.instructions_bn = D.payment.instructions_bn;
  s.seo = Object.assign({}, D.seo, s.seo || {});
  return s;
}
// find a billing period by months (or index); only active ones
function findPeriod(plan, months) {
  const act = (plan.periods || []).filter(x => x.active !== false);
  return act.find(x => Number(x.months) === Number(months)) || act[0];
}

// ---- sessions ----
async function createSession(req, res, kind, userId, tenantId, branchId, impersonated = false) {
  const id = token(32);
  const days = config.SESSION_DAYS;
  await db.q(`INSERT INTO sessions(id,kind,user_id,tenant_id,branch_id,impersonated,ip,ua,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' days')::interval)`,
    [id, kind, userId, tenantId || null, branchId || null, impersonated, req.ip, str(req.headers['user-agent'], 300), String(days)]);
  setCookie(req, res, kind === 'super' ? 'bx_s' : 'bx_u', id, days);
  return id;
}
async function destroySession(req, res, kind) {
  const name = kind === 'super' ? 'bx_s' : 'bx_u';
  const sid = parseCookies(req)[name];
  if (sid) await db.q('DELETE FROM sessions WHERE id=$1', [sid]);
  setCookie(req, res, name, '', 0);
}

// super admin guard
const requireSuper = wrap(async (req, res, next) => {
  const sid = parseCookies(req).bx_s;
  if (!sid) fail(401, 'Please log in', 'AUTH');
  const s = await db.one(`SELECT s.*, a.name, a.email, a.active FROM sessions s JOIN super_admins a ON a.id=s.user_id WHERE s.id=$1 AND s.kind='super' AND s.expires_at>now()`, [sid]);
  if (!s || !s.active) fail(401, 'Session expired, please log in again', 'AUTH');
  req.admin = { id: s.user_id, name: s.name, email: s.email };
  next();
});

// tenant user guard; perm may be string, array (any of) or null (just logged in)
function requireUser(perm, opts = {}) {
  return wrap(async (req, res, next) => {
    const sid = parseCookies(req).bx_u;
    if (!sid) fail(401, 'Please log in', 'AUTH');
    const s = await db.one(`SELECT s.id sid, s.branch_id sbranch, s.impersonated, s.last_seen, u.*, r.perms, r.is_owner, r.name role_name, r.key role_key,
        t.name t_name, t.slug t_slug, t.status t_status, t.expires_at t_expires, t.settings t_settings
      FROM sessions s JOIN users u ON u.id=s.user_id JOIN tenants t ON t.id=u.tenant_id LEFT JOIN roles r ON r.id=u.role_id AND r.tenant_id=u.tenant_id
      WHERE s.id=$1 AND s.kind='user' AND s.expires_at>now()`, [sid]);
    if (!s || !s.active) fail(401, 'Session expired, please log in again', 'AUTH');
    let status = s.t_status;
    if (status !== 'suspended' && s.t_expires && new Date(s.t_expires) < new Date()) {
      status = 'expired';
      if (s.t_status !== 'expired') await db.q(`UPDATE tenants SET status='expired' WHERE id=$1`, [s.tenant_id]);
    }
    const perms = s.is_owner ? Object.keys(PERMS) : (s.perms || []);
    req.user = { id: s.id, name: s.name, username: s.username, role: s.role_name, role_key: s.role_key, is_owner: !!s.is_owner, perms, branch_id: s.branch_id, impersonated: s.impersonated, sid: s.sid };
    req.tenant = { id: s.tenant_id, name: s.t_name, slug: s.t_slug, status, expires_at: s.t_expires, settings: Object.assign({}, TENANT_DEFAULTS, s.t_settings || {}) };
    req.tid = s.tenant_id;
    // active branch: fixed branch for branch users, otherwise chosen in session
    req.branchId = s.branch_id || s.sbranch;
    if (!req.branchId) {
      const b = await db.one('SELECT id FROM branches WHERE tenant_id=$1 ORDER BY id LIMIT 1', [req.tid]);
      req.branchId = b ? b.id : null;
    }
    if (!s.last_seen || Date.now() - new Date(s.last_seen).getTime() > 60000) {
      db.q('UPDATE sessions SET last_seen=now() WHERE id=$1', [s.sid]).catch(() => {});
      db.q('UPDATE tenants SET last_active=now() WHERE id=$1', [req.tid]).catch(() => {});
    }
    if (!opts.allowInactive) {
      if (status === 'suspended') fail(402, 'This account is suspended. Please contact support.', 'SUSPENDED');
      if (status === 'expired') fail(402, 'Your subscription has expired. Please renew from the Billing page.', 'EXPIRED');
    }
    if (perm) {
      const need = [].concat(perm);
      if (!need.some(p => perms.includes(p))) fail(403, 'You do not have permission for this action');
    }
    next();
  });
}
const can = (req, p) => req.user && req.user.perms.includes(p);

// Approval for sensitive operations: either user has perm, or a PIN/password of someone who has it
async function approve(req, perm, pin) {
  if (can(req, perm)) return req.user.id;
  if (!pin) fail(403, 'Manager approval required. Enter a manager PIN.', 'APPROVAL');
  const users = await db.all(`SELECT u.id, u.pin_hash, r.perms, r.is_owner FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.tenant_id=$1 AND u.active AND u.pin_hash IS NOT NULL`, [req.tid]);
  for (const u of users) {
    if ((u.is_owner || (u.perms || []).includes(perm)) && await check(pin, u.pin_hash)) return u.id;
  }
  fail(403, 'Approval PIN is not valid', 'APPROVAL');
}

async function audit(req, action, entity, entityId, details) {
  try {
    await db.q('INSERT INTO audit_logs(tenant_id,user_id,user_name,action,entity,entity_id,details,ip) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.tid, req.user && req.user.id, req.user && (req.user.name + (req.user.impersonated ? ' (support)' : '')), action, entity, entityId || null, details ? JSON.stringify(details) : null, req.ip]);
  } catch (e) { console.error('audit', e.message); }
}
async function notify(tid, branchId, type, title, body, link) {
  try { await db.q('INSERT INTO notifications(tenant_id,branch_id,type,title,body,link) VALUES($1,$2,$3,$4,$5,$6)', [tid, branchId || null, type, title, body || null, link || null]); }
  catch (e) { console.error('notify', e.message); }
}

// Optional SMS through any HTTP GET gateway: template like https://api.sms.com/send?to={to}&msg={msg}&key=XXXX
async function sendSMS(settings, to, msg) {
  try {
    if (!settings.sms_url || !to) return;
    const url = settings.sms_url.replace('{to}', encodeURIComponent(to)).replace('{msg}', encodeURIComponent(msg));
    if (!/^https?:\/\//i.test(url)) return;
    await fetch(url, { signal: AbortSignal.timeout(8000) });
  } catch (e) { console.error('sms', e.message); }
}

// ---- tenant creation with defaults & demo data ----
async function createTenant(data, seedDemo) {
  const s = await getSettings();
  const trialDays = num(data.trial_days, s.plan.trial_days || 14);
  return db.tx(async t => {
    const tenant = await t.one(`INSERT INTO tenants(name,slug,owner_name,phone,email,address,status,expires_at,settings)
      VALUES($1,$2,$3,$4,$5,$6,$7, now() + ($8 || ' days')::interval, $9) RETURNING *`,
      [data.name, data.slug, data.owner_name, data.phone, data.email, data.address || null, data.status || 'trial', String(trialDays),
        JSON.stringify(Object.assign({}, TENANT_DEFAULTS, { phone: data.phone, address: data.address || '' }))]);
    const tid = tenant.id;
    const branch = await t.one('INSERT INTO branches(tenant_id,name,address,phone) VALUES($1,$2,$3,$4) RETURNING id', [tid, 'Main Branch', data.address || '', data.phone || '']);
    const roleIds = {};
    for (const r of DEFAULT_ROLES) {
      const row = await t.one('INSERT INTO roles(tenant_id,key,name,perms,is_owner) VALUES($1,$2,$3,$4,$5) RETURNING id', [tid, r.key, r.name, JSON.stringify(r.perms), !!r.is_owner]);
      roleIds[r.key] = row.id;
    }
    const owner = await t.one(`INSERT INTO users(tenant_id,branch_id,role_id,name,username,phone,email,password_hash,pin_hash,designation,joined_at)
      VALUES($1,NULL,$2,$3,$4,$5,$6,$7,$8,'Owner',CURRENT_DATE) RETURNING id`,
      [tid, roleIds.owner, data.owner_name, data.username, data.phone, data.email, await hash(data.password), data.pin ? await hash(data.pin) : null]);
    const st = {};
    for (const n of ['Main Kitchen', 'Grill', 'Drinks & Desserts']) st[n] = (await t.one('INSERT INTO stations(tenant_id,name) VALUES($1,$2) RETURNING id', [tid, n])).id;
    for (const n of ['Rent', 'Utilities (Gas/Electricity/Water)', 'Salary', 'Marketing', 'Maintenance', 'Transport', 'Packaging', 'Miscellaneous'])
      await t.q('INSERT INTO expense_categories(tenant_id,name) VALUES($1,$2)', [tid, n]);
    await t.q(`INSERT INTO accounts(tenant_id,name,type) VALUES($1,'Cash in hand','cash'),($1,'Bank account','bank'),($1,'bKash merchant','mfs')`, [tid]);
    const floor = await t.one('INSERT INTO floors(tenant_id,branch_id,name,sort) VALUES($1,$2,$3,1) RETURNING id', [tid, branch.id, 'Ground Floor']);
    for (let i = 1; i <= 8; i++)
      await t.q('INSERT INTO tables(tenant_id,branch_id,floor_id,name,seats,qr_token) VALUES($1,$2,$3,$4,$5,$6)', [tid, branch.id, floor.id, 'T' + i, i <= 4 ? 4 : 6, token(10)]);
    await t.q(`INSERT INTO zones(tenant_id,name,charge,min_order) VALUES($1,'Within 3 km',40,200),($1,'3 - 6 km',70,300)`, [tid]);

    if (seedDemo) {
      const cat = {};
      for (const [i, n, s2] of [[1, 'Rice & Biryani', 'Main Kitchen'], [2, 'Burgers & Grill', 'Grill'], [3, 'Fast Food', 'Main Kitchen'], [4, 'Drinks', 'Drinks & Desserts'], [5, 'Desserts', 'Drinks & Desserts']])
        cat[n] = (await t.one('INSERT INTO categories(tenant_id,name,sort,station_id) VALUES($1,$2,$3,$4) RETURNING id', [tid, n, i, st[s2]])).id;
      const ing = {};
      for (const [n, u, c, m] of [['Chicken', 'g', 0.30, 5000], ['Basmati Rice', 'g', 0.08, 5000], ['Oil & Spices', 'g', 0.12, 2000], ['Packaging box', 'pcs', 10, 50],
        ['Burger Bun', 'pcs', 12, 30], ['Beef Patty', 'pcs', 70, 20], ['Cheese Slice', 'pcs', 15, 30], ['Potato', 'g', 0.04, 5000], ['Milk', 'ml', 0.09, 3000], ['Coffee Beans', 'g', 1.6, 500]]) {
        ing[n] = (await t.one('INSERT INTO ingredients(tenant_id,name,unit,cost,min_stock,purchase_unit,conversion) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [tid, n, u, c, m, u === 'g' ? 'kg' : u === 'ml' ? 'liter' : 'pcs', u === 'pcs' ? 1 : 1000])).id;
        await t.q('INSERT INTO stock(tenant_id,branch_id,ingredient_id,qty) VALUES($1,$2,$3,$4)', [tid, branch.id, ing[n], m * 4]);
      }
      const P = async (c, name, price, extra = {}) => (await t.one(`INSERT INTO products(tenant_id,category_id,name,price,variants,addons,description) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [tid, cat[c], name, price, JSON.stringify(extra.variants || []), JSON.stringify(extra.addons || []), extra.desc || null])).id;
      const biryani = await P('Rice & Biryani', 'Chicken Biryani', 220, { variants: [{ name: 'Regular', price: 220 }, { name: 'Large', price: 320 }], addons: [{ name: 'Extra egg', price: 25 }, { name: 'Borhani', price: 50 }], desc: 'Aromatic basmati with tender chicken' });
      await P('Rice & Biryani', 'Beef Tehari', 200);
      await P('Rice & Biryani', 'Plain Rice + Chicken Curry', 180);
      const burger = await P('Burgers & Grill', 'Beef Cheese Burger', 280, { addons: [{ name: 'Extra cheese', price: 30 }, { name: 'Extra patty', price: 90 }] });
      await P('Burgers & Grill', 'Grilled Chicken (Quarter)', 250);
      const fries = await P('Fast Food', 'French Fries', 120, { variants: [{ name: 'Regular', price: 120 }, { name: 'Large', price: 170 }] });
      await P('Fast Food', 'Chicken Fry (2 pcs)', 190);
      const coffee = await P('Drinks', 'Cold Coffee', 160);
      await P('Drinks', 'Lemon Mint', 110);
      await P('Drinks', 'Mineral Water', 30);
      await P('Desserts', 'Chocolate Brownie', 140);
      await P('Desserts', 'Firni', 90);
      const R = async (p, n, qty) => t.q('INSERT INTO recipes(tenant_id,product_id,ingredient_id,qty) VALUES($1,$2,$3,$4)', [tid, p, ing[n], qty]);
      await R(biryani, 'Chicken', 200); await R(biryani, 'Basmati Rice', 150); await R(biryani, 'Oil & Spices', 150); await R(biryani, 'Packaging box', 1);
      await R(burger, 'Burger Bun', 1); await R(burger, 'Beef Patty', 1); await R(burger, 'Cheese Slice', 1);
      await R(fries, 'Potato', 250); await R(fries, 'Oil & Spices', 40);
      await R(coffee, 'Milk', 200); await R(coffee, 'Coffee Beans', 15);
      await t.q(`INSERT INTO suppliers(tenant_id,name,phone,contact_person) VALUES($1,'Kazi Poultry','01700000000','Mr. Kazi'),($1,'City Grocery Wholesale','01800000000','Rahim')`, [tid]);
      await t.q(`INSERT INTO coupons(tenant_id,code,type,value,min_order,note) VALUES($1,'WELCOME10','percent',10,300,'10% off first visits')`, [tid]);
    }
    return { tenant, ownerId: owner.id, branchId: branch.id };
  });
}

// slug helper
const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

module.exports = {
  PERMS, DEFAULT_ROLES, TENANT_DEFAULTS, r2, num, int, token, str, hash, check, HttpError, fail, wrap,
  parseCookies, setCookie, rateLimit, normalizeSettings, findPeriod, failGuard, failHit, getSettings, clearSettingsCache, createSession, destroySession,
  requireSuper, requireUser, can, approve, audit, notify, sendSMS, createTenant, slugify
};
