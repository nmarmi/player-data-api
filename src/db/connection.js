const Database = require('better-sqlite3');
const path = require('path');

// Special case: when DB_PATH is the literal ":memory:", pass it straight to better-sqlite3
// so SQLite uses its true in-memory mode. Otherwise resolve as a real filesystem path.
const DB_PATH = process.env.DB_PATH === ':memory:'
  ? ':memory:'
  : process.env.DB_PATH
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : path.join(__dirname, '..', '..', 'data', 'players.db');

let db = null;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb, DB_PATH };
