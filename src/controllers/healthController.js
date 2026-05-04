/**
 * US-8.4: Health check.
 *
 * Returns operational status, database connectivity, last-sync timestamps per
 * source, and process uptime. The endpoint is exempt from license auth (US-8.5)
 * so external uptime checkers can hit it without holding a key.
 *
 * Responds 200 when the database is reachable, 503 when it is not.
 */

const { getDb } = require('../db/connection');
const log = require('../logger').child({ component: 'health' });

function checkDatabase() {
  try {
    const db = getDb();
    // Cheap round-trip — confirms the connection is open and the table exists.
    db.prepare('SELECT 1').get();
    return { connected: true };
  } catch (err) {
    log.warn('db check failed', { error: err.message });
    return { connected: false, error: err.message };
  }
}

function getDataFreshness() {
  try {
    const { getSyncStatus } = require('../db/syncLog');
    const rows = getSyncStatus();
    return rows.reduce((acc, row) => {
      acc[row.source] = {
        lastSyncAt: row.lastSyncAt,
        status:     row.status,
        isStale:    row.isStale,
      };
      return acc;
    }, {});
  } catch (_) {
    return {};
  }
}

function getHealth(_req, res) {
  const database = checkDatabase();
  const dataFreshness = database.connected ? getDataFreshness() : {};
  const uptimeSeconds = Math.round(process.uptime());

  const body = {
    success: database.connected,
    status: database.connected ? 'ok' : 'degraded',
    service: 'player-data-api',
    database,
    dataFreshness,
    uptimeSeconds,
  };

  res.status(database.connected ? 200 : 503).json(body);
}

module.exports = { getHealth };
