// Generic, permission-checked CRUD for simple restaurant records.
// The same schema is sent to the browser to build forms and tables automatically.
const express = require('express');
const db = require('./db');
const c = require('./core');
const { wrap, fail, str, num, int } = c;
const r = express.Router();

// field types: text, textarea, num, int, bool, date, time, select(options), ref(resource), json, image, phone, email
const RES = {
  branches: { title: 'Branches', perm: 'branches', fields: {
    name: { t: 'text', label: 'Branch name', req: true }, address: { t: 'text', label: 'Address' }, phone: { t: 'phone', label: 'Phone' },
    online_ordering: { t: 'bool', label: 'Online / QR ordering', def: true }, active: { t: 'bool', label: 'Active', def: true } } },
  stations: { title: 'Kitchen stations', perm: 'menu', readPerm: ['menu', 'kitchen', 'pos'], fields: { name: { t: 'text', label: 'Station name', req: true }, active: { t: 'bool', label: 'Active', def: true } } },
  categories: { title: 'Categories', perm: 'menu', readPerm: ['menu', 'pos'], order: 'sort, id', fields: {
    name: { t: 'text', label: 'Category name', req: true }, station_id: { t: 'ref', ref: 'stations', label: 'Kitchen station' },
    sort: { t: 'int', label: 'Sort order', def: 0 }, image_id: { t: 'image', label: 'Image', hide: true }, active: { t: 'bool', label: 'Active', def: true } } },
  products: { title: 'Products', perm: 'menu', readPerm: ['menu', 'pos', 'recipes', 'coupons'], order: 'sort, name', search: ['name', 'sku', 'barcode'], fields: {
    image_id: { t: 'image', label: 'Photo' }, name: { t: 'text', label: 'Product name', req: true }, category_id: { t: 'ref', ref: 'categories', label: 'Category' },
    price: { t: 'num', label: 'Price', req: true }, description: { t: 'textarea', label: 'Description', hide: true },
    variants: { t: 'json', kind: 'priced', label: 'Sizes / variants (option + price)', hide: true }, addons: { t: 'json', kind: 'priced', label: 'Add-ons / toppings (name + extra price)', hide: true },
    sku: { t: 'text', label: 'SKU', hide: true }, barcode: { t: 'text', label: 'Barcode', hide: true }, station_id: { t: 'ref', ref: 'stations', label: 'Kitchen station (override)', hide: true },
    available: { t: 'bool', label: 'Available now', def: true }, active: { t: 'bool', label: 'Active', def: true },
    by_weight: { t: 'bool', label: 'Sold by weight (price per kg)', hide: true }, tax_exempt: { t: 'bool', label: 'VAT exempt', hide: true },
    combo_items: { t: 'textarea', label: 'Combo / bundle includes (for display)', hide: true },
    avail_from: { t: 'time', label: 'Menu time from (e.g. breakfast 07:00)', hide: true, group: 'Timing & pricing' }, avail_to: { t: 'time', label: 'Menu time to', hide: true },
    happy_price: { t: 'num', label: 'Happy-hour price', hide: true }, happy_from: { t: 'time', label: 'Happy hour from', hide: true }, happy_to: { t: 'time', label: 'Happy hour to', hide: true },
    sched_price: { t: 'num', label: 'Scheduled new price', hide: true }, sched_from: { t: 'date', label: 'New price starts on', hide: true },
    branch_ids: { t: 'json', kind: 'branches', label: 'Sell only in these branches (empty = all)', hide: true },
    branch_prices: { t: 'json', kind: 'branchprices', label: 'Branch-specific prices', hide: true },
    sort: { t: 'int', label: 'Sort order', def: 0, hide: true } } },
  ingredients: { title: 'Ingredients / raw materials', perm: 'inventory', readPerm: ['inventory', 'recipes', 'purchases'], order: 'name', search: ['name', 'category'], fields: {
    name: { t: 'text', label: 'Ingredient name', req: true }, category: { t: 'text', label: 'Group (e.g. Meat, Dairy)' },
    unit: { t: 'select', label: 'Stock unit', options: ['g', 'kg', 'ml', 'liter', 'pcs', 'pack', 'dozen', 'box'], def: 'g' },
    purchase_unit: { t: 'select', label: 'Purchase unit', options: ['', 'kg', 'g', 'liter', 'ml', 'pcs', 'pack', 'dozen', 'box', 'bag', 'carton'], hide: true },
    conversion: { t: 'num', label: '1 purchase unit = how many stock units', def: 1, hide: true },
    cost: { t: 'num', label: 'Cost per stock unit', def: 0 }, min_stock: { t: 'num', label: 'Minimum stock alert', def: 0 },
    yield_pct: { t: 'num', label: 'Cooking yield % (after trimming/cooking)', def: 100, hide: true }, active: { t: 'bool', label: 'Active', def: true } } },
  suppliers: { title: 'Suppliers', perm: 'suppliers', readPerm: ['suppliers', 'purchases'], order: 'name', search: ['name', 'phone', 'contact_person'], fields: {
    name: { t: 'text', label: 'Supplier name', req: true }, contact_person: { t: 'text', label: 'Contact person' }, phone: { t: 'phone', label: 'Phone' },
    email: { t: 'email', label: 'Email', hide: true }, address: { t: 'text', label: 'Address', hide: true }, notes: { t: 'textarea', label: 'Notes', hide: true }, active: { t: 'bool', label: 'Active', def: true } } },
  customers: { title: 'Customers', perm: 'customers', readPerm: ['customers', 'pos', 'delivery', 'reservations'], writePerm: ['customers', 'pos'], order: 'id DESC', search: ['name', 'phone', 'email', 'tags'], fields: {
    name: { t: 'text', label: 'Name', req: true }, phone: { t: 'phone', label: 'Phone' }, email: { t: 'email', label: 'Email', hide: true }, address: { t: 'text', label: 'Address', hide: true },
    birthday: { t: 'date', label: 'Birthday', hide: true }, anniversary: { t: 'date', label: 'Anniversary', hide: true }, tags: { t: 'text', label: 'Segment / tags (VIP, Corporate…)' },
    preferences: { t: 'textarea', label: 'Preferences (spicy, no onion…)', hide: true }, notes: { t: 'textarea', label: 'Notes', hide: true },
    special_discount: { t: 'num', label: 'Customer special discount %', def: 0, hide: true }, credit_limit: { t: 'num', label: 'Credit (due) limit, 0 = no limit', def: 0, hide: true },
    points: { t: 'num', label: 'Loyalty points', ro: true }, total_spent: { t: 'num', label: 'Total spent', ro: true }, visits: { t: 'int', label: 'Visits', ro: true },
    due: { t: 'num', label: 'Due', ro: true }, blocked: { t: 'bool', label: 'Restricted / blacklisted', hide: true } } },
  feedback: { title: 'Feedback & complaints', perm: 'customers', order: 'id DESC', search: ['customer_name', 'phone', 'message'], fields: {
    type: { t: 'select', label: 'Type', options: ['feedback', 'complaint'], def: 'feedback' }, customer_name: { t: 'text', label: 'Customer' }, phone: { t: 'phone', label: 'Phone' },
    rating: { t: 'int', label: 'Rating (1-5)' }, message: { t: 'textarea', label: 'Message' }, order_no: { t: 'int', label: 'Order #', hide: true },
    status: { t: 'select', label: 'Status', options: ['open', 'in progress', 'resolved'], def: 'open' } } },
  floors: { title: 'Floors & sections', perm: 'tables', readPerm: ['tables', 'pos'], branch: true, order: 'sort, id', fields: {
    name: { t: 'text', label: 'Floor / section name', req: true }, sort: { t: 'int', label: 'Sort', def: 0 } } },
  tables: { title: 'Tables', perm: 'tables', readPerm: ['tables', 'pos', 'reservations'], branch: true, order: 'name', fields: {
    name: { t: 'text', label: 'Table name / number', req: true }, floor_id: { t: 'ref', ref: 'floors', label: 'Floor / section' }, seats: { t: 'int', label: 'Seats', def: 4 },
    shape: { t: 'select', label: 'Shape', options: ['square', 'round', 'long'], def: 'square', hide: true }, waiter_id: { t: 'ref', ref: 'users', label: 'Assigned waiter' },
    status: { t: 'select', label: 'Status', options: ['available', 'reserved', 'cleaning'], def: 'available' } } },
  riders: { title: 'Delivery riders', perm: 'delivery', branch: true, order: 'name', fields: {
    name: { t: 'text', label: 'Rider name', req: true }, phone: { t: 'phone', label: 'Phone' }, vehicle: { t: 'text', label: 'Vehicle' },
    per_delivery: { t: 'num', label: 'Pay per delivery', def: 0 }, available: { t: 'bool', label: 'Available', def: true }, active: { t: 'bool', label: 'Active', def: true } } },
  rider_payments: { title: 'Rider payments', perm: 'delivery', order: 'id DESC', fields: {
    rider_id: { t: 'ref', ref: 'riders', label: 'Rider', req: true }, type: { t: 'select', label: 'Type', options: ['payment', 'cash deposit', 'advance'], def: 'payment' },
    amount: { t: 'num', label: 'Amount', req: true }, date: { t: 'date', label: 'Date', def: 'today' }, note: { t: 'text', label: 'Note' } } },
  zones: { title: 'Delivery zones', perm: 'delivery', readPerm: ['delivery', 'pos'], fields: {
    name: { t: 'text', label: 'Zone / area', req: true }, charge: { t: 'num', label: 'Delivery charge', def: 0 }, per_km: { t: 'num', label: 'Extra per km', def: 0, hide: true },
    min_order: { t: 'num', label: 'Minimum order', def: 0 }, active: { t: 'bool', label: 'Active', def: true } } },
  coupons: { title: 'Coupons & offers', perm: 'coupons', order: 'id DESC', search: ['code', 'note'], fields: {
    code: { t: 'text', label: 'Coupon code', req: true, upper: true }, type: { t: 'select', label: 'Type', options: ['percent', 'fixed', 'bogo'], def: 'percent' },
    value: { t: 'num', label: 'Value (% or amount)', def: 0 }, bogo_product_id: { t: 'ref', ref: 'products', label: 'Buy-1-get-1 product (for bogo)', hide: true },
    min_order: { t: 'num', label: 'Minimum order', def: 0 }, max_discount: { t: 'num', label: 'Max discount (0 = no cap)', def: 0, hide: true },
    max_uses: { t: 'int', label: 'Max uses (0 = unlimited)', def: 0, hide: true }, used: { t: 'int', label: 'Used', ro: true },
    starts: { t: 'date', label: 'Starts', hide: true }, ends: { t: 'date', label: 'Ends' }, first_order_only: { t: 'bool', label: 'First order only', hide: true },
    note: { t: 'text', label: 'Description', hide: true }, active: { t: 'bool', label: 'Active', def: true } } },
  reservations: { title: 'Reservations', perm: 'reservations', branch: true, order: 'date DESC, time DESC', search: ['customer_name', 'phone'], fields: {
    customer_name: { t: 'text', label: 'Guest name', req: true }, phone: { t: 'phone', label: 'Phone' }, date: { t: 'date', label: 'Date', req: true, def: 'today' },
    time: { t: 'time', label: 'Time', req: true }, guests: { t: 'int', label: 'Guests', def: 2 }, table_id: { t: 'ref', ref: 'tables', label: 'Table' },
    event_type: { t: 'select', label: 'Type', options: ['Regular', 'Birthday', 'Anniversary', 'Corporate', 'Party / Event'], def: 'Regular' },
    deposit: { t: 'num', label: 'Deposit taken', def: 0 }, status: { t: 'select', label: 'Status', options: ['booked', 'confirmed', 'waitlist', 'seated', 'completed', 'cancelled', 'no_show'], def: 'booked' },
    note: { t: 'textarea', label: 'Special requests', hide: true } } },
  accounts: { title: 'Cash & bank accounts', perm: 'accounting', fields: {
    name: { t: 'text', label: 'Account name', req: true }, type: { t: 'select', label: 'Type', options: ['cash', 'bank', 'mfs'], def: 'cash' }, number: { t: 'text', label: 'Account number' },
    opening_balance: { t: 'num', label: 'Opening balance', def: 0 }, active: { t: 'bool', label: 'Active', def: true } } },
  expense_categories: { title: 'Expense categories', perm: 'accounting', readPerm: ['accounting', 'shifts', 'pos'], order: 'name', fields: { name: { t: 'text', label: 'Category', req: true } } },
  expenses: { title: 'Expenses', perm: 'accounting', branch: true, order: 'date DESC, id DESC', search: ['note'], fields: {
    date: { t: 'date', label: 'Date', req: true, def: 'today' }, category_id: { t: 'ref', ref: 'expense_categories', label: 'Category', req: true },
    amount: { t: 'num', label: 'Amount', req: true }, account_id: { t: 'ref', ref: 'accounts', label: 'Paid from account' },
    method: { t: 'select', label: 'Method', options: ['Cash', 'Bank', 'bKash', 'Nagad', 'Card'], def: 'Cash' }, petty: { t: 'bool', label: 'Petty cash', hide: true }, note: { t: 'text', label: 'Note' } } },
  incomes: { title: 'Other income', perm: 'accounting', branch: true, order: 'date DESC, id DESC', fields: {
    date: { t: 'date', label: 'Date', req: true, def: 'today' }, source: { t: 'text', label: 'Source', req: true }, amount: { t: 'num', label: 'Amount', req: true },
    account_id: { t: 'ref', ref: 'accounts', label: 'Received to account' }, method: { t: 'select', label: 'Method', options: ['Cash', 'Bank', 'bKash', 'Nagad', 'Card'], def: 'Cash' }, note: { t: 'text', label: 'Note' } } },
  journals: { title: 'Journal entries', perm: 'accounting', order: 'date DESC, id DESC', fields: {
    date: { t: 'date', label: 'Date', req: true, def: 'today' }, account_id: { t: 'ref', ref: 'accounts', label: 'Account', req: true },
    debit: { t: 'num', label: 'Debit (money in)', def: 0 }, credit: { t: 'num', label: 'Credit (money out)', def: 0 }, ref: { t: 'text', label: 'Reference' }, note: { t: 'text', label: 'Narration' } } },
  salary_payments: { title: 'Salary & advances', perm: 'staff', order: 'date DESC, id DESC', fields: {
    user_id: { t: 'ref', ref: 'users', label: 'Employee', req: true }, type: { t: 'select', label: 'Type', options: ['salary', 'advance', 'bonus', 'overtime', 'deduction'], def: 'salary' },
    month: { t: 'text', label: 'For month (YYYY-MM)', def: 'month' }, amount: { t: 'num', label: 'Amount', req: true }, hours: { t: 'num', label: 'Overtime hours', hide: true },
    method: { t: 'select', label: 'Method', options: ['Cash', 'Bank', 'bKash', 'Nagad'], def: 'Cash' }, date: { t: 'date', label: 'Date', def: 'today' }, note: { t: 'text', label: 'Note', hide: true } } },
  leaves: { title: 'Leave requests', perm: 'staff', order: 'id DESC', fields: {
    user_id: { t: 'ref', ref: 'users', label: 'Employee', req: true }, type: { t: 'select', label: 'Type', options: ['casual', 'sick', 'annual', 'unpaid'], def: 'casual' },
    from_date: { t: 'date', label: 'From', req: true }, to_date: { t: 'date', label: 'To', req: true }, reason: { t: 'text', label: 'Reason' },
    status: { t: 'select', label: 'Status', options: ['pending', 'approved', 'rejected'], def: 'pending' } } },
  shift_schedules: { title: 'Shift schedule', perm: 'staff', branch: true, order: 'date DESC, start_time', fields: {
    user_id: { t: 'ref', ref: 'users', label: 'Employee', req: true }, date: { t: 'date', label: 'Date', req: true, def: 'today' },
    start_time: { t: 'time', label: 'Start', req: true }, end_time: { t: 'time', label: 'End', req: true }, note: { t: 'text', label: 'Duty / note' } } },
  users: { title: 'Staff', perm: 'settings', readPerm: ['settings', 'staff', 'tables', 'pos', 'reports', 'delivery'], readonly: true, order: 'name', fields: {
    name: { t: 'text', label: 'Name' }, username: { t: 'text', label: 'Username' }, designation: { t: 'text', label: 'Designation' } } }
};

const TODAY = () => new Date().toISOString().slice(0, 10);
function castVal(f, v) {
  if (v === undefined) return undefined;
  if (v === '' || v === null) return f.t === 'bool' ? false : (f.t === 'json' ? (f.kind === 'branchprices' ? {} : []) : null);
  switch (f.t) {
    case 'num': { const n = parseFloat(v); if (!Number.isFinite(n)) fail(400, `${f.label} must be a number`); return n; }
    case 'int': case 'ref': case 'image': { const n = parseInt(v, 10); if (!Number.isFinite(n)) return null; return n; }
    case 'bool': return v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
    case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) fail(400, `${f.label}: invalid date`); return String(v);
    case 'time': if (!/^\d{2}:\d{2}$/.test(String(v))) fail(400, `${f.label}: use HH:MM`); return String(v);
    case 'json': {
      let j = v; if (typeof v === 'string') { try { j = JSON.parse(v); } catch (e) { fail(400, `${f.label}: invalid data`); } }
      if (f.kind === 'priced') return JSON.stringify((Array.isArray(j) ? j : []).filter(x => x && x.name).slice(0, 50).map(x => ({ name: String(x.name).slice(0, 80), price: parseFloat(x.price) || 0 })));
      if (f.kind === 'branches') return JSON.stringify((Array.isArray(j) ? j : []).map(x => parseInt(x, 10)).filter(Number.isFinite));
      if (f.kind === 'branchprices') { const o = {}; Object.entries(j || {}).forEach(([k, val]) => { if (val !== '' && val !== null && Number.isFinite(parseFloat(val))) o[String(parseInt(k, 10))] = parseFloat(val); }); return JSON.stringify(o); }
      return JSON.stringify(j);
    }
    case 'select': if (f.options && !f.options.includes(String(v))) fail(400, `${f.label}: invalid choice`); return String(v);
    default: { let s = String(v).trim().slice(0, f.t === 'textarea' ? 4000 : 300); if (f.upper) s = s.toUpperCase(); return s; }
  }
}

function getRes(name) { const d = RES[name]; if (!d) fail(404, 'Unknown resource'); return d; }
const permOf = (d, mode) => mode === 'read' ? (d.readPerm || d.perm) : (d.writePerm || d.perm);

async function validateRefs(tid, d, data) {
  for (const [k, f] of Object.entries(d.fields)) {
    if ((f.t === 'ref') && data[k]) {
      const ok = await db.one(`SELECT 1 FROM ${RES[f.ref] ? f.ref : 'users'} WHERE id=$1 AND tenant_id=$2`, [data[k], tid]);
      if (!ok) fail(400, `${f.label}: selected item not found`);
    }
    if (f.t === 'image' && data[k]) {
      const ok = await db.one('SELECT 1 FROM files WHERE id=$1 AND tenant_id=$2', [data[k], tid]);
      if (!ok) data[k] = null;
    }
  }
}

function permMw(mode) {
  return (req, res, next) => {
    const d = RES[req.params.res];
    if (!d) return res.status(404).json({ error: 'Unknown resource' });
    return c.requireUser(permOf(d, mode))(req, res, next);
  };
}

// list
r.get('/:res', permMw('read'), wrap(async (req, res) => {
  const d = getRes(req.params.res);
  const params = [req.tid]; let where = 'tenant_id=$1';
  if (d.branch && req.query.all_branches !== '1') { params.push(req.branchId); where += ` AND branch_id=$${params.length}`; }
  if (req.query.q && d.search) {
    params.push('%' + req.query.q + '%');
    where += ' AND (' + d.search.map(f => `${f}::text ILIKE $${params.length}`).join(' OR ') + ')';
  }
  for (const [k, f] of Object.entries(d.fields)) {
    if (req.query[k] !== undefined && req.query[k] !== '' && f.t !== 'json') { params.push(castVal(f, req.query[k])); where += ` AND ${k}=$${params.length}`; }
  }
  if (req.query.from && d.fields.date) { params.push(req.query.from); where += ` AND date >= $${params.length}`; }
  if (req.query.to && d.fields.date) { params.push(req.query.to); where += ` AND date <= $${params.length}`; }
  if (req.query.active_only === '1' && d.fields.active) where += ' AND active';
  const limit = Math.min(int(req.query.limit, 500) || 500, 2000), offset = Math.max(0, int(req.query.offset, 0));
  const cols = req.params.res === 'users' ? 'id, name, username, designation, branch_id, active' : '*';
  const rows = await db.all(`SELECT ${cols} FROM ${req.params.res} WHERE ${where} ORDER BY ${d.order || 'id DESC'} LIMIT ${limit} OFFSET ${offset}`, params);
  res.json(rows);
}));

r.get('/:res/:id', permMw('read'), wrap(async (req, res) => {
  const d = getRes(req.params.res);
  if (req.params.res === 'users') fail(404, 'Use the staff API');
  const row = await db.one(`SELECT * FROM ${req.params.res} WHERE id=$1 AND tenant_id=$2`, [int(req.params.id, 0), req.tid]);
  if (!row || (d.branch && req.user.branch_id && row.branch_id !== req.user.branch_id)) fail(404, 'Not found');
  res.json(row);
}));

function collect(d, body, creating) {
  const data = {};
  for (const [k, f] of Object.entries(d.fields)) {
    if (f.ro) continue;
    let v = body[k];
    if (v === undefined && creating && f.def !== undefined) v = f.def === 'today' ? TODAY() : f.def === 'month' ? TODAY().slice(0, 7) : f.def;
    if (v === undefined) continue;
    data[k] = castVal(f, v);
    if (f.req && (data[k] === null || data[k] === '')) fail(400, `${f.label} is required`);
  }
  if (creating) for (const [k, f] of Object.entries(d.fields)) if (f.req && (data[k] === undefined || data[k] === null || data[k] === '')) fail(400, `${f.label} is required`);
  return data;
}

r.post('/:res', permMw('write'), wrap(async (req, res) => {
  const d = getRes(req.params.res);
  if (d.readonly) fail(400, 'Read only');
  const data = collect(d, req.body || {}, true);
  await validateRefs(req.tid, d, data);
  if (d.branch) data.branch_id = req.branchId;
  if (req.params.res === 'tables') data.qr_token = c.token(10);
  if (['expenses', 'incomes', 'journals'].includes(req.params.res)) data.user_id = req.user.id;
  const keys = Object.keys(data);
  const row = await db.one(`INSERT INTO ${req.params.res}(tenant_id${keys.map(k => ',' + k).join('')}) VALUES($1${keys.map((k, i) => ',$' + (i + 2)).join('')}) RETURNING *`, [req.tid, ...keys.map(k => data[k])]);
  await c.audit(req, 'create', req.params.res, row.id, { name: row.name || row.code || row.customer_name || row.amount });
  if (req.params.res === 'reservations') reservationSMS(req, row);
  res.json(row);
}));

r.put('/:res/:id', permMw('write'), wrap(async (req, res) => {
  const d = getRes(req.params.res);
  if (d.readonly) fail(400, 'Read only');
  const data = collect(d, req.body || {}, false);
  await validateRefs(req.tid, d, data);
  const keys = Object.keys(data);
  if (!keys.length) fail(400, 'Nothing to update');
  const params = [int(req.params.id, 0), req.tid, ...keys.map(k => data[k])];
  let where = 'id=$1 AND tenant_id=$2';
  if (d.branch && req.user.branch_id) { params.push(req.user.branch_id); where += ` AND branch_id=$${params.length}`; }
  const row = await db.one(`UPDATE ${req.params.res} SET ${keys.map((k, i) => `${k}=$${i + 3}`).join(', ')} WHERE ${where} RETURNING *`, params);
  if (!row) fail(404, 'Not found');
  if (req.params.res === 'tables' && data.status) await db.q('UPDATE tables SET status_since=now() WHERE id=$1', [row.id]);
  await c.audit(req, 'update', req.params.res, row.id, data.status ? { status: data.status } : null);
  if (req.params.res === 'reservations' && data.status === 'confirmed') reservationSMS(req, row);
  res.json(row);
}));

r.delete('/:res/:id', permMw('write'), wrap(async (req, res) => {
  const d = getRes(req.params.res);
  if (d.readonly) fail(400, 'Read only');
  if (req.params.res === 'branches') {
    const n = await db.one('SELECT count(*)::int n FROM branches WHERE tenant_id=$1', [req.tid]);
    if (n.n <= 1) fail(400, 'You need at least one branch');
    const used = await db.one('SELECT count(*)::int n FROM orders WHERE branch_id=$1', [int(req.params.id)]);
    if (used.n) fail(400, 'This branch has orders. Deactivate it instead of deleting.');
  }
  if (req.params.res === 'products' || req.params.res === 'ingredients') {
    const col = req.params.res === 'products' ? 'product_id' : 'ingredient_id';
    const used = await db.one(`SELECT count(*)::int n FROM ${req.params.res === 'products' ? 'order_items' : 'stock_moves'} WHERE ${col}=$1`, [int(req.params.id)]);
    if (used.n) fail(400, 'This item has history. Turn off "Active" instead of deleting, to keep your reports correct.');
    await db.q(`DELETE FROM recipes WHERE ${col}=$1 AND tenant_id=$2`, [int(req.params.id), req.tid]);
  }
  const dp = [int(req.params.id, 0), req.tid];
  const bw = d.branch && req.user.branch_id ? (dp.push(req.user.branch_id), ' AND branch_id=$3') : '';
  const row = await db.one(`DELETE FROM ${req.params.res} WHERE id=$1 AND tenant_id=$2${bw} RETURNING id`, dp);
  if (!row) fail(404, 'Not found');
  await c.audit(req, 'delete', req.params.res, row.id);
  res.json({ ok: true });
}));

// bulk import (rows already parsed from CSV in the browser)
r.post('/:res/import', permMw('write'), wrap(async (req, res) => {
  const d = getRes(req.params.res);
  if (d.readonly) fail(400, 'Read only');
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 5000) : [];
  let ok = 0; const errors = [];
  for (const [i, raw] of rows.entries()) {
    try {
      const body = {};
      for (const [k, f] of Object.entries(d.fields)) {
        const v = raw[k] !== undefined ? raw[k] : raw[f.label];
        if (v !== undefined && f.t !== 'image') body[k] = v;
      }
      // allow category / supplier by name
      for (const [k, f] of Object.entries(d.fields)) {
        if (f.t === 'ref' && body[k] && !/^\d+$/.test(String(body[k]))) {
          const ref = await db.one(`SELECT id FROM ${f.ref} WHERE tenant_id=$1 AND lower(name)=lower($2)`, [req.tid, String(body[k])]);
          if (ref) body[k] = ref.id;
          else if (f.ref === 'categories') body[k] = (await db.one('INSERT INTO categories(tenant_id,name) VALUES($1,$2) RETURNING id', [req.tid, String(body[k]).slice(0, 100)])).id;
          else body[k] = null;
        }
      }
      const data = collect(d, body, true);
      if (d.branch) data.branch_id = req.branchId;
      if (req.params.res === 'tables') data.qr_token = c.token(10);
      const keys = Object.keys(data);
      await db.q(`INSERT INTO ${req.params.res}(tenant_id${keys.map(k => ',' + k).join('')}) VALUES($1${keys.map((k, j) => ',$' + (j + 2)).join('')})`, [req.tid, ...keys.map(k => data[k])]);
      ok++;
    } catch (e) { errors.push(`Row ${i + 2}: ${e.message}`); }
  }
  await c.audit(req, 'import', req.params.res, null, { imported: ok, failed: errors.length });
  res.json({ imported: ok, errors: errors.slice(0, 50) });
}));

function reservationSMS(req, row) {
  const s = req.tenant.settings;
  if (row.phone && s.sms_events && s.sms_events.reservation)
    c.sendSMS(s, row.phone, `${req.tenant.name}: your table for ${row.guests} on ${row.date} at ${row.time} is ${row.status === 'confirmed' ? 'confirmed' : 'booked'}. Thank you!`);
}

module.exports = r;
module.exports.RES = RES;
