
const path = require('path');

module.exports = {
  PORT: 3000,
  DATABASE_URL: 'postgres://postgres:qTndRsFy7hDSOgRdZuraamxF7YviSve5OZMKKoL2nw6g7Sd4TypzzD9a301qm0Ku@201.18.212.48:5444/postgres',                 // e.g. 'postgres://postgres:secret@postgres-xyz:5432/postgres'
  DB_SSL: false,   
  DATA_DIR: path.join(__dirname, 'data'),
  SESSION_DAYS: 30,    
  BACKUP_KEEP: 7,             
  TRUST_PROXY: true                 
};
