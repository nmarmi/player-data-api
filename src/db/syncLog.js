const { getDb } = require('./connection');

const SOURCES = ['player_metadata', 'injuries', 'depth_charts', 'transactions'];

/** Default staleness threshold in hours per source */
const STALENESS_THRESHOLDS_HOURS = {
  player_metadata: 24,
  injuries:        1,
  depth_charts:    6,
  transactions:    1,
};

function createSyncLogTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS data_sync_log (
      source        TEXT    PRIMARY KEY,
      last_sync_at  TEXT,
      status        TEXT    NOT NULL DEFAULT 'never',
      record_count  INTEGER NOT NULL DEFAULT 0,
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO data_sync_log (source, last_sync_at, status, record_count)
    VALUES (@source, NULL, 'never', 0)
  `);
  const insertMany = db.transaction((sources) => {
    for (const source of sources) insert.run({ source });
  });
  insertMany(SOURCES);

  console.log('[db] data_sync_log table ready');
}

/**
 * Record a completed sync for a given source.
 * @param {string} source - one of the SOURCES values
 * @param {'success'|'error'} status
 * @param {number} recordCount
 */
function recordSync(source, status, recordCount = 0) {
  const db = getDb();
  db.prepare(`
    INSERT INTO data_sync_log (source, last_sync_at, status, record_count, updated_at)
    VALUES (@source, datetime('now'), @status, @record_count, datetime('now'))
    ON CONFLICT(source) DO UPDATE SET
      last_sync_at = excluded.last_sync_at,
      status       = excluded.status,
      record_count = excluded.record_count,
      updated_at   = excluded.updated_at
  `).run({ source, status, record_count: recordCount });
}

/**
 * Returns true if the source has never been synced or was last synced
 * more than its threshold hours ago.
 * @param {string} source
 * @returns {boolean}
 */
function isStale(source) {
  const db = getDb();
  const row = db.prepare('SELECT last_sync_at, status FROM data_sync_log WHERE source = ?').get(source);
  if (!row || !row.last_sync_at || row.status === 'never') return true;

  const thresholdHours = STALENESS_THRESHOLDS_HOURS[source] ?? 24;
  const lastSync = new Date(row.last_sync_at + 'Z');
  const ageHours = (Date.now() - lastSync.getTime()) / (1000 * 60 * 60);
  return ageHours >= thresholdHours;
}

/**
 * Returns the full sync log for all sources.
 * @returns {Array<{source, last_sync_at, status, record_count, is_stale}>}
 */
function getSyncStatus() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM data_sync_log ORDER BY source').all();
  return rows.map((row) => ({
    source:       row.source,
    lastSyncAt:   row.last_sync_at,
    status:       row.status,
    recordCount:  row.record_count,
    isStale:      isStale(row.source),
    thresholdHours: STALENESS_THRESHOLDS_HOURS[row.source] ?? 24,
  }));
}

module.exports = { createSyncLogTable, recordSync, isStale, getSyncStatus, SOURCES };
