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

  // US-4.3: depth chart columns — added after initial schema, safe to re-run
  for (const col of [
    'ALTER TABLE players ADD COLUMN depth_chart_rank     INTEGER',
    'ALTER TABLE players ADD COLUMN depth_chart_position TEXT',
  ]) {
    try { db.exec(col); } catch (_) { /* column already exists */ }
  }

  // US-4.4: transactions audit table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      txn_id         INTEGER PRIMARY KEY,
      player_id      TEXT    NOT NULL,
      mlb_person_id  INTEGER NOT NULL,
      type_code      TEXT    NOT NULL,
      type_desc      TEXT    NOT NULL,
      from_team_id   INTEGER,
      to_team_id     INTEGER,
      effective_date TEXT    NOT NULL,
      description    TEXT,
      recorded_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // US-4.8: season stats table (hitting + pitching)
  // ip stored as true decimal (e.g. 187.2 IP → 187.667).
  // UNIQUE on (player_id, season, stat_group) makes upserts idempotent.
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_stats (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id     TEXT    NOT NULL,
      mlb_person_id INTEGER NOT NULL,
      season        INTEGER NOT NULL,
      stat_group    TEXT    NOT NULL,
      games_played  INTEGER NOT NULL DEFAULT 0,
      ab            REAL    NOT NULL DEFAULT 0,
      r             REAL    NOT NULL DEFAULT 0,
      h             REAL    NOT NULL DEFAULT 0,
      doubles       REAL    NOT NULL DEFAULT 0,
      triples       REAL    NOT NULL DEFAULT 0,
      hr            REAL    NOT NULL DEFAULT 0,
      rbi           REAL    NOT NULL DEFAULT 0,
      bb            REAL    NOT NULL DEFAULT 0,
      k             REAL    NOT NULL DEFAULT 0,
      sb            REAL    NOT NULL DEFAULT 0,
      avg           REAL    NOT NULL DEFAULT 0,
      obp           REAL    NOT NULL DEFAULT 0,
      slg           REAL    NOT NULL DEFAULT 0,
      ops           REAL    NOT NULL DEFAULT 0,
      w             REAL    NOT NULL DEFAULT 0,
      l             REAL    NOT NULL DEFAULT 0,
      era           REAL    NOT NULL DEFAULT 0,
      whip          REAL    NOT NULL DEFAULT 0,
      k9            REAL    NOT NULL DEFAULT 0,
      ip            REAL    NOT NULL DEFAULT 0,
      sv            REAL    NOT NULL DEFAULT 0,
      hld           REAL    NOT NULL DEFAULT 0,
      qs            REAL    NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(player_id, season, stat_group)
    )
  `);

  createSyncLogTable();
  console.log('[db] Migration complete — all tables ready');
}

module.exports = { migrate };
