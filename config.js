// ============================================================
//  Baybex Restaurant SaaS — configuration (no .env, no yml)
// ============================================================
//  Two ways to connect the database:
//
//  A) Hardcode it here:
//       DATABASE_URL: 'postgres://user:password@host:5432/dbname'
//
//  B) Leave DATABASE_URL empty, deploy, then open  https://your-domain/setup
//     and fill the form. It is saved to data/config.json
//     (mount /app/data as persistent storage in Coolify so it survives redeploys).
// ============================================================
const path = require('path');

module.exports = {
  PORT: 3000,
  DATABASE_URL: '',                 // e.g. 'postgres://postgres:secret@postgres-xyz:5432/postgres'
  DB_SSL: false,                    // true only if your Postgres requires SSL (managed cloud DBs)
  DATA_DIR: path.join(__dirname, 'data'),
  SESSION_DAYS: 30,                 // login stays valid for this many days
  BACKUP_KEEP: 7,                   // automatic daily JSON backups kept in data/backups
  TRUST_PROXY: true                 // Coolify/Traefik sits in front — keep true
};
