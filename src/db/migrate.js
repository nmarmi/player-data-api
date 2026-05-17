const { getDb } = require('./connection');
const { createSyncLogTable } = require('./syncLog');
const log = require('../logger').child({ component: 'db' });

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
    // US-11.3: birth date for age-factor valuation
    'ALTER TABLE players ADD COLUMN birth_date           TEXT',
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

  // US-11.2: forward-looking projection rows (Steamer / ZiPS / manual)
  // Same column set as player_stats; PK is (player_id, season, stat_group, source).
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_projections (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id     TEXT    NOT NULL,
      mlb_person_id INTEGER NOT NULL DEFAULT 0,
      season        INTEGER NOT NULL,
      stat_group    TEXT    NOT NULL,
      source        TEXT    NOT NULL DEFAULT 'manual',
      games_played  INTEGER NOT NULL DEFAULT 0,
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
      UNIQUE(player_id, season, stat_group, source)
    )
  `);

  // US-9.2: persisted analytics events
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      event       TEXT    NOT NULL,
      api_key     TEXT,
      metadata    TEXT    NOT NULL DEFAULT '{}',
      recorded_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // US-10.1: developer account model
  db.exec(`
    CREATE TABLE IF NOT EXISTS developer_accounts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      is_admin      INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // US-10.1: issued API keys (one account → many keys)
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id   INTEGER NOT NULL REFERENCES developer_accounts(id),
      key_hash     TEXT    NOT NULL UNIQUE,
      label        TEXT    NOT NULL DEFAULT '',
      ip_whitelist TEXT    NOT NULL DEFAULT '[]',
      revoked_at   TEXT,
      last_used_at TEXT,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // US-13.1: push notification events — written by ingestion jobs, read by SSE stream
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT    NOT NULL,
      player_id     TEXT    NOT NULL,
      payload       TEXT    NOT NULL DEFAULT '{}',
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      dispatched_at TEXT
    )
  `);

  // US-13.2: webhook URL per api_key (optional; null = SSE only)
  try { db.exec('ALTER TABLE api_keys ADD COLUMN webhook_url TEXT'); } catch (_) {}

  // US-10.4: API key usage audit log (rolling 30-day TTL enforced on write)
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_key_usage_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id     INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      path       TEXT    NOT NULL,
      method     TEXT    NOT NULL,
      status     INTEGER NOT NULL DEFAULT 0,
      ip         TEXT,
      at         TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // One-time cleanup: remove seed rows that were stored with an empty mlb_team
  // due to a field-name mismatch in seed.js (players.json uses `team`, not `mlbTeam`).
  // Real players always have a team from ingestPlayerMetadata, so mlb_team = '' is a
  // reliable signal for orphaned seed rows with fabricated MLB IDs.
  const orphanedCount = db
    .prepare(`SELECT COUNT(*) as n FROM players WHERE mlb_team = ''`)
    .get().n;
  if (orphanedCount > 0) {
    db.prepare(`DELETE FROM players WHERE mlb_team = ''`).run();
    log.info('cleanup: removed orphaned seed rows', { count: orphanedCount });
  }

  createSyncLogTable();
  log.info('migration complete', { tablesReady: 'all' });
}

module.exports = { migrate };
