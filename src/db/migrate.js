const { getDb } = require('./connection');
const { createSyncLogTable } = require('./syncLog');

/**
 * US-3.2: Creates the players table if it does not already exist.
 * US-3.4: Creates the data_sync_log table.
 * Positions are stored as a JSON string (array of strings).
 * Stats columns mirror the existing PlayerStub + stats model.
 */
function migrate() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      player_id     TEXT PRIMARY KEY,
      mlb_person_id INTEGER NOT NULL,
      name          TEXT    NOT NULL,
      player_name   TEXT    NOT NULL,
      positions     TEXT    NOT NULL DEFAULT '[]',
      position      TEXT    NOT NULL DEFAULT '',
      mlb_team      TEXT    NOT NULL DEFAULT '',
      mlb_team_id   TEXT,
      status        TEXT    NOT NULL DEFAULT 'active',
      is_available  INTEGER NOT NULL DEFAULT 1,
      ab            REAL    NOT NULL DEFAULT 0,
      r             REAL    NOT NULL DEFAULT 0,
      h             REAL    NOT NULL DEFAULT 0,
      hr            REAL    NOT NULL DEFAULT 0,
      rbi           REAL    NOT NULL DEFAULT 0,
      bb            REAL    NOT NULL DEFAULT 0,
      k             REAL    NOT NULL DEFAULT 0,
      sb            REAL    NOT NULL DEFAULT 0,
      avg           REAL    NOT NULL DEFAULT 0,
      obp           REAL    NOT NULL DEFAULT 0,
      slg           REAL    NOT NULL DEFAULT 0,
      fpts          REAL    NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  createSyncLogTable();
  console.log('[db] Migration complete — all tables ready');
}

module.exports = { migrate };
