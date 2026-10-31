// Database: connection pool, helpers, schema migration (raw SQL)
const { Pool, types } = require('pg');
types.setTypeParser(1700, v => (v === null ? null : parseFloat(v))); // NUMERIC -> number
types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10)));  // BIGINT (count) -> number
types.setTypeParser(1082, v => v);                                     // DATE stays 'YYYY-MM-DD'

let pool = null;
let isReady = false;

function connect(url, ssl) {
  if (pool) pool.end().catch(() => {});
  pool = new Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false, max: 15 });
  pool.on('error', e => console.error('PG pool error', e.message));
  return pool;
}
async function testConnection(url, ssl) {
  const p = new Pool({ connectionString: url, ssl: ssl ? { rejectUnauthorized: false } : false, max: 1, connectionTimeoutMillis: 8000 });
  try { await p.query('SELECT 1'); } finally { await p.end().catch(() => {}); }
}
const ready = () => !!pool && isReady;
const setReady = v => { isReady = v; };
const q = (text, params) => pool.query(text, params);
async function one(text, params) { const r = await pool.query(text, params); return r.rows[0] || null; }
async function all(text, params) { const r = await pool.query(text, params); return r.rows; }
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const helper = {
      q: (t, p) => c.query(t, p),
      one: async (t, p) => (await c.query(t, p)).rows[0] || null,
      all: async (t, p) => (await c.query(t, p)).rows
    };
    const res = await fn(helper);
    await c.query('COMMIT');
    return res;
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}

// ---- schema -------------------------------------------------------------
const T = (name, cols) => `CREATE TABLE IF NOT EXISTS ${name} (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, ${cols}, created_at TIMESTAMPTZ DEFAULT now());`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value JSONB);
CREATE TABLE IF NOT EXISTS super_admins (id SERIAL PRIMARY KEY, name TEXT, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now(), last_login TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS tenants (id SERIAL PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, owner_name TEXT, phone TEXT, email TEXT, address TEXT,
  status TEXT DEFAULT 'trial', expires_at TIMESTAMPTZ, settings JSONB DEFAULT '{}'::jsonb, notes TEXT, order_seq INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(), last_active TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS sub_payments (id SERIAL PRIMARY KEY, tenant_id INT REFERENCES tenants(id) ON DELETE CASCADE, amount NUMERIC(12,2), method TEXT, trx_id TEXT, sender TEXT,
  days INT, status TEXT DEFAULT 'pending', note TEXT, created_at TIMESTAMPTZ DEFAULT now(), decided_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS announcements (id SERIAL PRIMARY KEY, title TEXT, body TEXT, level TEXT DEFAULT 'info', active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id INT NOT NULL, tenant_id INT, branch_id INT, impersonated BOOLEAN DEFAULT false,
  ip TEXT, ua TEXT, created_at TIMESTAMPTZ DEFAULT now(), last_seen TIMESTAMPTZ DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS files (id SERIAL PRIMARY KEY, tenant_id INT, mime TEXT, data BYTEA, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS login_logs (id SERIAL PRIMARY KEY, kind TEXT, tenant_id INT, user_id INT, username TEXT, success BOOLEAN, ip TEXT, ua TEXT, created_at TIMESTAMPTZ DEFAULT now());

${T('branches', `name TEXT NOT NULL, address TEXT, phone TEXT, active BOOLEAN DEFAULT true, online_ordering BOOLEAN DEFAULT true`)}
${T('roles', `key TEXT, name TEXT NOT NULL, perms JSONB DEFAULT '[]'::jsonb, is_owner BOOLEAN DEFAULT false`)}
${T('users', `branch_id INT, role_id INT, name TEXT NOT NULL, username TEXT NOT NULL, phone TEXT, email TEXT, password_hash TEXT, pin_hash TEXT, active BOOLEAN DEFAULT true,
  salary NUMERIC(12,2) DEFAULT 0, designation TEXT, address TEXT, joined_at DATE, last_login TIMESTAMPTZ, UNIQUE(tenant_id, username)`)}
${T('stations', `name TEXT NOT NULL, active BOOLEAN DEFAULT true`)}
${T('categories', `name TEXT NOT NULL, sort INT DEFAULT 0, active BOOLEAN DEFAULT true, station_id INT, image_id INT`)}
${T('products', `category_id INT, name TEXT NOT NULL, description TEXT, price NUMERIC(12,2) DEFAULT 0, sku TEXT, barcode TEXT, image_id INT, active BOOLEAN DEFAULT true,
  available BOOLEAN DEFAULT true, variants JSONB DEFAULT '[]'::jsonb, addons JSONB DEFAULT '[]'::jsonb, station_id INT, branch_ids JSONB DEFAULT '[]'::jsonb,
  branch_prices JSONB DEFAULT '{}'::jsonb, avail_from TEXT, avail_to TEXT, happy_price NUMERIC(12,2), happy_from TEXT, happy_to TEXT, by_weight BOOLEAN DEFAULT false,
  combo_items TEXT, tax_exempt BOOLEAN DEFAULT false, sort INT DEFAULT 0, sched_price NUMERIC(12,2), sched_from DATE`)}
${T('ingredients', `name TEXT NOT NULL, unit TEXT DEFAULT 'pcs', purchase_unit TEXT, conversion NUMERIC(12,4) DEFAULT 1, cost NUMERIC(14,4) DEFAULT 0,
  min_stock NUMERIC(14,3) DEFAULT 0, category TEXT, yield_pct NUMERIC(6,2) DEFAULT 100, active BOOLEAN DEFAULT true`)}
CREATE TABLE IF NOT EXISTS stock (tenant_id INT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, branch_id INT NOT NULL, ingredient_id INT NOT NULL, qty NUMERIC(14,3) DEFAULT 0, PRIMARY KEY(branch_id, ingredient_id));
${T('stock_moves', `branch_id INT, ingredient_id INT, type TEXT, qty NUMERIC(14,3), unit_cost NUMERIC(14,4), ref TEXT, batch TEXT, expiry DATE, note TEXT, user_id INT, system_qty NUMERIC(14,3)`)}
${T('recipes', `product_id INT NOT NULL, ingredient_id INT NOT NULL, qty NUMERIC(14,4) NOT NULL`)}
${T('recipe_versions', `product_id INT, items JSONB, cost NUMERIC(14,4), note TEXT, user_id INT`)}
${T('suppliers', `name TEXT NOT NULL, contact_person TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT, active BOOLEAN DEFAULT true`)}
${T('purchases', `branch_id INT, supplier_id INT, ref_no TEXT, invoice_no TEXT, date DATE, status TEXT DEFAULT 'received', type TEXT DEFAULT 'purchase', subtotal NUMERIC(14,2) DEFAULT 0,
  discount NUMERIC(14,2) DEFAULT 0, total NUMERIC(14,2) DEFAULT 0, paid NUMERIC(14,2) DEFAULT 0, note TEXT, user_id INT, approved_by INT, received_at TIMESTAMPTZ`)}
${T('purchase_items', `purchase_id INT REFERENCES purchases(id) ON DELETE CASCADE, ingredient_id INT, qty NUMERIC(14,3), unit_cost NUMERIC(14,4), total NUMERIC(14,2), batch TEXT, expiry DATE`)}
${T('supplier_payments', `supplier_id INT, purchase_id INT, amount NUMERIC(14,2), method TEXT, date DATE, note TEXT, user_id INT`)}
${T('customers', `name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT, birthday DATE, anniversary DATE, notes TEXT, preferences TEXT, tags TEXT,
  points NUMERIC(12,2) DEFAULT 0, total_spent NUMERIC(14,2) DEFAULT 0, visits INT DEFAULT 0, due NUMERIC(14,2) DEFAULT 0, credit_limit NUMERIC(14,2) DEFAULT 0,
  special_discount NUMERIC(6,2) DEFAULT 0, referred_by INT, blocked BOOLEAN DEFAULT false, last_visit TIMESTAMPTZ`)}
${T('customer_payments', `customer_id INT, amount NUMERIC(14,2), method TEXT, note TEXT, user_id INT, shift_id INT`)}
${T('feedback', `customer_id INT, customer_name TEXT, phone TEXT, rating INT, type TEXT DEFAULT 'feedback', message TEXT, status TEXT DEFAULT 'open', order_no INT`)}
${T('floors', `branch_id INT, name TEXT NOT NULL, sort INT DEFAULT 0`)}
${T('tables', `branch_id INT, floor_id INT, name TEXT NOT NULL, seats INT DEFAULT 4, status TEXT DEFAULT 'available', waiter_id INT, qr_token TEXT UNIQUE, shape TEXT DEFAULT 'square', status_since TIMESTAMPTZ`)}
${T('riders', `branch_id INT, name TEXT NOT NULL, phone TEXT, vehicle TEXT, active BOOLEAN DEFAULT true, available BOOLEAN DEFAULT true, per_delivery NUMERIC(10,2) DEFAULT 0`)}
${T('rider_payments', `rider_id INT, type TEXT DEFAULT 'payment', amount NUMERIC(12,2), note TEXT, date DATE`)}
${T('zones', `name TEXT NOT NULL, charge NUMERIC(10,2) DEFAULT 0, per_km NUMERIC(10,2) DEFAULT 0, min_order NUMERIC(10,2) DEFAULT 0, active BOOLEAN DEFAULT true`)}
${T('coupons', `code TEXT NOT NULL, type TEXT DEFAULT 'percent', value NUMERIC(12,2) DEFAULT 0, min_order NUMERIC(12,2) DEFAULT 0, max_discount NUMERIC(12,2) DEFAULT 0,
  max_uses INT DEFAULT 0, used INT DEFAULT 0, starts DATE, ends DATE, first_order_only BOOLEAN DEFAULT false, bogo_product_id INT, active BOOLEAN DEFAULT true, note TEXT, UNIQUE(tenant_id, code)`)}
${T('shifts', `branch_id INT, user_id INT, opened_at TIMESTAMPTZ DEFAULT now(), opening_cash NUMERIC(12,2) DEFAULT 0, closed_at TIMESTAMPTZ, closing_cash NUMERIC(12,2),
  expected_cash NUMERIC(12,2), note TEXT, status TEXT DEFAULT 'open'`)}
${T('cash_moves', `shift_id INT, branch_id INT, type TEXT, amount NUMERIC(12,2), note TEXT, user_id INT`)}
${T('orders', `branch_id INT, order_no INT, type TEXT DEFAULT 'takeaway', source TEXT DEFAULT 'pos', status TEXT DEFAULT 'open', table_id INT, customer_id INT,
  customer_name TEXT, customer_phone TEXT, address TEXT, zone_id INT, waiter_id INT, cashier_id INT, shift_id INT, rider_id INT, delivery_status TEXT, vehicle_no TEXT, guests INT,
  subtotal NUMERIC(14,2) DEFAULT 0, item_discount NUMERIC(14,2) DEFAULT 0, discount_type TEXT, discount_value NUMERIC(12,2) DEFAULT 0, discount NUMERIC(14,2) DEFAULT 0,
  coupon_code TEXT, points_redeemed NUMERIC(12,2) DEFAULT 0, vat NUMERIC(14,2) DEFAULT 0, service_charge NUMERIC(14,2) DEFAULT 0, delivery_charge NUMERIC(14,2) DEFAULT 0,
  total NUMERIC(14,2) DEFAULT 0, paid NUMERIC(14,2) DEFAULT 0, change_due NUMERIC(14,2) DEFAULT 0, refunded NUMERIC(14,2) DEFAULT 0, note TEXT, priority BOOLEAN DEFAULT false,
  cost NUMERIC(14,2) DEFAULT 0, track_token TEXT, client_uuid TEXT, scheduled_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ, cancel_reason TEXT,
  merged_into INT, payment_note TEXT, updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE(tenant_id, client_uuid)`)}
${T('order_items', `order_id INT REFERENCES orders(id) ON DELETE CASCADE, product_id INT, name TEXT, variant TEXT, addons JSONB DEFAULT '[]'::jsonb, qty NUMERIC(10,3) DEFAULT 1,
  unit_price NUMERIC(12,2) DEFAULT 0, discount NUMERIC(12,2) DEFAULT 0, total NUMERIC(14,2) DEFAULT 0, note TEXT, station_id INT, kstatus TEXT DEFAULT 'draft',
  sent_at TIMESTAMPTZ, started_at TIMESTAMPTZ, ready_at TIMESTAMPTZ, served_at TIMESTAMPTZ, cost NUMERIC(14,2) DEFAULT 0, tax_exempt BOOLEAN DEFAULT false`)}
${T('order_payments', `order_id INT, shift_id INT, branch_id INT, method TEXT, amount NUMERIC(14,2), ref TEXT, user_id INT`)}
${T('refunds', `order_id INT, branch_id INT, amount NUMERIC(14,2), method TEXT, reason TEXT, restock BOOLEAN DEFAULT false, user_id INT, approved_by INT, shift_id INT`)}
${T('attendance', `user_id INT, date DATE, clock_in TIMESTAMPTZ, clock_out TIMESTAMPTZ, note TEXT`)}
${T('leaves', `user_id INT, from_date DATE, to_date DATE, type TEXT DEFAULT 'casual', reason TEXT, status TEXT DEFAULT 'pending'`)}
${T('salary_payments', `user_id INT, type TEXT DEFAULT 'salary', month TEXT, amount NUMERIC(12,2), hours NUMERIC(8,2), method TEXT, date DATE, note TEXT`)}
${T('shift_schedules', `user_id INT, branch_id INT, date DATE, start_time TEXT, end_time TEXT, note TEXT`)}
${T('accounts', `name TEXT NOT NULL, type TEXT DEFAULT 'cash', number TEXT, opening_balance NUMERIC(14,2) DEFAULT 0, active BOOLEAN DEFAULT true`)}
${T('expense_categories', `name TEXT NOT NULL`)}
${T('expenses', `branch_id INT, category_id INT, account_id INT, amount NUMERIC(14,2), method TEXT, date DATE, note TEXT, user_id INT, shift_id INT, petty BOOLEAN DEFAULT false`)}
${T('incomes', `branch_id INT, source TEXT, account_id INT, amount NUMERIC(14,2), method TEXT, date DATE, note TEXT, user_id INT`)}
${T('journals', `date DATE, account_id INT, debit NUMERIC(14,2) DEFAULT 0, credit NUMERIC(14,2) DEFAULT 0, ref TEXT, note TEXT, user_id INT`)}
${T('period_closings', `period TEXT, from_date DATE, to_date DATE, summary JSONB, user_id INT`)}
${T('reservations', `branch_id INT, customer_name TEXT NOT NULL, phone TEXT, date DATE, time TEXT, guests INT DEFAULT 2, table_id INT, status TEXT DEFAULT 'booked',
  deposit NUMERIC(12,2) DEFAULT 0, event_type TEXT, note TEXT, reminded BOOLEAN DEFAULT false`)}
${T('notifications', `branch_id INT, type TEXT, title TEXT, body TEXT, link TEXT, read BOOLEAN DEFAULT false`)}
${T('audit_logs', `user_id INT, user_name TEXT, action TEXT, entity TEXT, entity_id INT, details JSONB, ip TEXT`)}

CREATE INDEX IF NOT EXISTS ix_orders_t ON orders(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_oi_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS ix_oi_t ON order_items(tenant_id, kstatus);
CREATE INDEX IF NOT EXISTS ix_op_t ON order_payments(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS ix_moves_t ON stock_moves(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS ix_notif_t ON notifications(tenant_id, id);
CREATE INDEX IF NOT EXISTS ix_audit_t ON audit_logs(tenant_id, id);
CREATE INDEX IF NOT EXISTS ix_products_t ON products(tenant_id);
CREATE INDEX IF NOT EXISTS ix_customers_t ON customers(tenant_id, phone);
CREATE INDEX IF NOT EXISTS ix_sessions_exp ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS ix_orders_track ON orders(track_token);
`;

const DEFAULT_SETTINGS = {
  brand: {
    name: 'Baybex Restaurant', tagline: 'Complete restaurant operating system — POS, kitchen, inventory, accounts',
    logo_id: null, color: '#0f766e', phone: '01750006696', email: 'bussiness@baybexai.com', website: 'baybex.com',
    footer: '© Baybex. All rights reserved.', currency: '৳'
  },
  plan: {
    name: 'Baybex All-in-One', price: 1500, duration_days: 30, trial_days: 14,
    yearly_price: 15000, note: 'Every feature included. Unlimited branches, staff and orders.',
    features: ['POS & billing (dine-in, takeaway, delivery)', 'Kitchen display system', 'Table & floor plan', 'Menu, variants & add-ons',
      'Inventory & recipe costing', 'Purchase & suppliers', 'Customers, loyalty & coupons', 'QR menu & online ordering',
      'Delivery & riders', 'Reservations', 'Staff, attendance & payroll', 'Accounting & reports', 'Multi-branch', 'Multi-level staff logins']
  },
  payment: {
    instructions: 'Send Money to the number below, then submit the Transaction ID. Your account is activated after verification.',
    methods: [{ name: 'bKash', number: '01750006696', type: 'Personal' }, { name: 'Nagad', number: '01750006696', type: 'Personal' }]
  },
  landing: {
    hero_title: 'Run your whole restaurant from one screen',
    hero_sub: 'POS, kitchen display, inventory, recipe costing, QR ordering, delivery, staff and accounts — built for restaurants, cafes, bakeries and cloud kitchens in Bangladesh.',
    cta: 'Start free trial',
    features: [
      { icon: '🧾', title: 'Fast POS', text: 'Dine-in, takeaway and delivery billing with split bills, VAT, service charge and bKash/Nagad.' },
      { icon: '👨‍🍳', title: 'Kitchen display', text: 'Orders flow straight to grill, drinks or bakery stations with live timers.' },
      { icon: '📦', title: 'Inventory & recipes', text: 'Ingredients deduct automatically on every sale. Know your food cost per dish.' },
      { icon: '📱', title: 'QR menu & online orders', text: 'Guests scan the table QR, order and track — no app needed.' },
      { icon: '🛵', title: 'Delivery', text: 'Zones, charges, riders and cash collection in one board.' },
      { icon: '📊', title: 'Reports & accounts', text: 'Daily sales, profit & loss, VAT report, cashbook and branch comparison.' }
    ],
    faq: [
      { q: 'Do I need to install anything?', a: 'No. It runs in the browser on any PC, tablet or phone.' },
      { q: 'Can my staff have separate logins?', a: 'Yes. Owner, manager, cashier, waiter, kitchen, accountant — each sees only what you allow. Staff can also log in with a quick PIN.' },
      { q: 'What happens after the trial?', a: 'Pay via bKash/Nagad from the Billing page and continue with all your data intact.' }
    ]
  },
  signup_enabled: true,
  seo: { title: 'Baybex Restaurant Management System', description: 'Restaurant POS + ERP SaaS for Bangladesh' }
};

async function migrate() {
  await q(SCHEMA);
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await q('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO NOTHING', [k, JSON.stringify(v)]);
  }
}

module.exports = { setReady, connect, testConnection, ready, q, one, all, tx, migrate, DEFAULT_SETTINGS };
