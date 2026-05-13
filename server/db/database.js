import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { config } from '../config/index.js';

let SQL;
let db;
let dbPath = config.databasePath;
let transactionDepth = 0;

function ensureParent(filePath) {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }
}

function rowsFromStatement(statement) {
  const rows = [];
  while (statement.step()) {
    rows.push(statement.getAsObject());
  }
  statement.free();
  return rows;
}

export async function initDatabase(options = {}) {
  dbPath = options.dbPath || dbPath;
  if (!SQL) {
    SQL = await initSqlJs();
  }

  if (db) {
    db.close();
  }

  if (dbPath !== ':memory:' && fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    ensureParent(dbPath);
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON;');
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database has not been initialized.');
  }
  return db;
}

export function saveDatabase() {
  if (!db || dbPath === ':memory:') return;
  ensureParent(dbPath);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
}

export function run(sql, params = []) {
  getDb().run(sql, params);
  if (transactionDepth === 0) {
    saveDatabase();
  }
}

export function all(sql, params = []) {
  const statement = getDb().prepare(sql);
  statement.bind(params);
  return rowsFromStatement(statement);
}

export function get(sql, params = []) {
  return all(sql, params)[0] || null;
}

export function insert(sql, params = []) {
  getDb().run(sql, params);
  const id = Number(get('SELECT last_insert_rowid() AS id').id);
  if (transactionDepth === 0) {
    saveDatabase();
  }
  return id;
}

export function transaction(callback) {
  transactionDepth += 1;
  run('BEGIN');
  try {
    const result = callback();
    run('COMMIT');
    transactionDepth -= 1;
    if (transactionDepth === 0) {
      saveDatabase();
    }
    return result;
  } catch (error) {
    run('ROLLBACK');
    transactionDepth -= 1;
    throw error;
  }
}

export async function asyncTransaction(callback) {
  transactionDepth += 1;
  getDb().run('BEGIN');
  try {
    const result = await callback();
    getDb().run('COMMIT');
    transactionDepth -= 1;
    if (transactionDepth === 0) {
      saveDatabase();
    }
    return result;
  } catch (error) {
    getDb().run('ROLLBACK');
    transactionDepth -= 1;
    throw error;
  }
}

export function closeDatabase() {
  if (db) {
    saveDatabase();
    db.close();
    db = undefined;
  }
}

export function now() {
  return new Date().toISOString();
}
