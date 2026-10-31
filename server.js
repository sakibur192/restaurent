// ============================================================
//  Baybex Restaurant Management System — SaaS server
//  Node.js + Express + PostgreSQL (raw SQL). No .env / no yml.
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./src/db');
const core = require('./src/core');

const app = express();
if (config.TRUST_PROXY) app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '6mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  next();
});

const CONFIG_FILE = path.join(config.DATA_DIR, 'config.json');
fs.mkdirSync(config.DATA_DIR, { recursive: true });

function loadDbConfig() {
  if (config.DATABASE_URL) return { url: config.DATABASE_URL, ssl: config.DB_SSL };
  try { const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); if (c.url) return c; } catch (e) { /* not configured yet */ }
  return null;
}

async function boot(cfg) {
  db.connect(cfg.url, cfg.ssl);
  await db.migrate();
  db.setReady(true);
  console.log('Database connected and schema is up to date');
}

// ---------- setup wizard (only while DB is not configured or no super admin exists) ----------
async function needsSetup() {
  if (!db.ready()) return true;
  try { const r = await db.one('SELECT count(*)::int n FROM super_admins'); return r.n === 0; } catch (e) { return true; }
}
app.get('/api/setup/status', core.wrap(async (req, res) => {
  res.json({ needs_setup: await needsSetup(), db_connected: db.ready(), db_hardcoded: !!config.DATABASE_URL });
}));
app.post('/api/setup', core.wrap(async (req, res) => {
  if (!(await needsSetup())) core.fail(400, 'Setup is already complete');
  core.rateLimit('setup:' + req.ip, 20);
  const b = req.body || {};
  if (!db.ready()) {
    if (loadDbConfig()) core.fail(503, 'A database is already configured but is not reachable right now. Check that PostgreSQL is running (or edit data/config.json / config.js).');
    let url = core.str(b.db_url, 500);
    if (!url) {
      if (!b.db_host || !b.db_user || !b.db_name) core.fail(400, 'Fill the database host, user and database name');
      url = `postgres://${encodeURIComponent(b.db_user)}:${encodeURIComponent(b.db_password || '')}@${b.db_host}:${core.int(b.db_port, 5432)}/${encodeURIComponent(b.db_name)}`;
    }
    const ssl = !!b.db_ssl;
    try { await db.testConnection(url, ssl); } catch (e) { core.fail(400, 'Could not connect to PostgreSQL: ' + e.message); }
    await boot({ url, ssl });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ url, ssl }, null, 2));
  }
  const exists = await db.one('SELECT count(*)::int n FROM super_admins');
  if (exists.n === 0) {
    if (!b.admin_email || !b.admin_password || String(b.admin_password).length < 6) core.fail(400, 'Enter super admin email and a password of at least 6 characters');
    await db.q('INSERT INTO super_admins(name,email,password_hash) VALUES($1,$2,$3)', [core.str(b.admin_name, 100) || 'Super Admin', String(b.admin_email).trim().toLowerCase(), await core.hash(b.admin_password)]);
  }
  if (b.brand_name) {
    const s = await core.getSettings();
    s.brand.name = core.str(b.brand_name, 100);
    await db.q(`INSERT INTO settings(key,value) VALUES('brand',$1) ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(s.brand)]);
    core.clearSettingsCache();
  }
  res.json({ ok: true });
}));

// Any API call before DB is ready -> tell the client to run setup
app.use('/api', (req, res, next) => {
  if (!db.ready()) return res.status(503).json({ error: 'System is not set up yet. Open /setup', code: 'SETUP' });
  next();
});

// ---------- routes ----------
app.use('/api/super', require('./src/routes-super'));
app.use('/api', require('./src/routes-public'));
app.use('/api/app', require('./src/routes-app'));
app.use('/api/app', require('./src/routes-app2'));
app.use('/api/r', require('./src/routes-resources'));

// uploaded images (stored in PostgreSQL so they survive redeploys)
app.get('/f/:id', core.wrap(async (req, res) => {
  const f = await db.one('SELECT mime, data FROM files WHERE id=$1', [core.int(req.params.id, 0)]);
  if (!f) return res.status(404).end();
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.end(f.data);
}));

// ---------- static pages ----------
const PUB = path.join(__dirname, 'public');
app.use(express.static(PUB, { extensions: ['html'], maxAge: '1h', index: false }));
const page = f => (req, res) => res.sendFile(path.join(PUB, f));
app.get('/', async (req, res) => { if (await needsSetup()) return res.redirect('/setup'); page('index.html')(req, res); });
app.get('/setup', page('setup.html'));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));
app.get('/login', page('login.html'));
app.get('/signup', page('signup.html'));
app.get('/admin', page('admin.html'));
app.get('/app', page('app.html'));
app.get('/m/:slug', page('menu.html'));          // QR / online menu  (?t=tableToken, ?kiosk=1)
app.get('/board/:slug', page('board.html'));     // digital menu board
app.get('/track/:token', page('track.html'));    // order tracking
app.get('/display', page('display.html'));       // customer facing display

// ---------- errors ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  if (err instanceof core.HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'File is too large' });
  if (err.code === '23505') return res.status(400).json({ error: 'This value already exists (duplicate). Use a different one.' });
  if (err.code === '22P02' || err.code === '22007' || err.code === '22008') return res.status(400).json({ error: 'Invalid value in the form. Please check numbers and dates.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ---------- housekeeping: session cleanup + automatic daily JSON backup ----------
async function housekeeping() {
  if (!db.ready()) return;
  try { await db.q('DELETE FROM sessions WHERE expires_at < now()'); } catch (e) { /* ignore */ }
  try {
    const dir = path.join(config.DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(dir, `backup-${today}.json`);
    if (!fs.existsSync(file)) {
      const dump = await require('./src/routes-super').dumpAll();
      fs.writeFileSync(file, JSON.stringify(dump));
      const files = fs.readdirSync(dir).filter(f => f.startsWith('backup-')).sort();
      while (files.length > config.BACKUP_KEEP) fs.unlinkSync(path.join(dir, files.shift()));
      console.log('Automatic backup written', file);
    }
  } catch (e) { console.error('backup failed', e.message); }
}

(async () => {
  const cfg = loadDbConfig();
  if (cfg) {
    const tryBoot = async () => {
      try { await boot(cfg); } catch (e) {
        console.error('Database connection failed:', e.message, '— retrying in 10s (fix config.js / data/config.json if this repeats)');
        setTimeout(tryBoot, 10000);
      }
    };
    await tryBoot();
  } else console.log('No database configured yet — open /setup in your browser');
  app.listen(config.PORT, '0.0.0.0', () => console.log(`Baybex Restaurant SaaS running on port ${config.PORT}`));
  setTimeout(housekeeping, 15000);
  setInterval(housekeeping, 6 * 3600 * 1000);
})();
