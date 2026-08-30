const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

const fileMap = {};
function regFile(name, filePath) { fileMap[name] = filePath; }

async function initPG() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kv (
        collection TEXT NOT NULL,
        key TEXT NOT NULL,
        data JSONB NOT NULL,
        PRIMARY KEY (collection, key)
      )
    `);
    console.log('✅ PostgreSQL conectado');
  } catch (e) { console.error('❌ PostgreSQL erro:', e.message); }
}

function loadDB(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function saveDB(file, db) {
  fs.writeFileSync(file, JSON.stringify(db, null, 2));
  if (pool) syncToPG(file, db).catch(e => console.error('PG save error:', e.message));
}

async function syncToPG(file, db) {
  if (!pool) return;
  const collection = Object.entries(fileMap).find(([, v]) => v === file)?.[0];
  if (!collection) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM kv WHERE collection = $1', [collection]);
    if (db && typeof db === 'object') {
      const entries = Array.isArray(db) ? db.map((v, i) => [String(i), v]) : Object.entries(db);
      for (const [key, value] of entries) {
        if (value !== undefined && value !== null) {
          await client.query('INSERT INTO kv (collection, key, data) VALUES ($1, $2, $3)', [collection, key, JSON.stringify(value)]);
        }
      }
    }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}

async function restoreFromPG() {
  if (!pool) return;
  try {
    const res = await pool.query('SELECT DISTINCT collection FROM kv');
    for (const row of res.rows) {
      const filePath = fileMap[row.collection];
      if (!filePath) continue;
      const dataRes = await pool.query('SELECT key, data FROM kv WHERE collection = $1', [row.collection]);
      if (dataRes.rows.length === 0) continue;
      const isMessages = row.collection === 'messages';
      let obj;
      if (isMessages) {
        obj = dataRes.rows.map(r => r.data);
      } else {
        obj = {};
        dataRes.rows.forEach(r => { obj[r.key] = r.data; });
      }
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(obj, null, 2));
      console.log(`🔄 Restored ${row.collection} (${dataRes.rows.length} entries)`);
    }
  } catch (e) { console.error('PG restore error:', e.message); }
}

module.exports = { pool, regFile, initPG, loadDB, saveDB, restoreFromPG };
