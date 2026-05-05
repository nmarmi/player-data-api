const log = require('../logger').child({ component: 'usage' });

let _getDb = null;
function tryGetDb() {
  if (!_getDb) {
    try { _getDb = require('../db/connection').getDb; } catch (_) {}
  }
  try { return _getDb ? _getDb() : null; } catch (_) { return null; }
}

let _getSyncStatus = null;
function trySyncStatus() {
  if (!_getSyncStatus) {
    try { _getSyncStatus = require('../db/syncLog').getSyncStatus; } catch (_) {}
  }
  try { return _getSyncStatus ? _getSyncStatus() : null; } catch (_) { return null; }
}

function recordUsage(req, res) {
  const { event, timestamp, metadata } = req.body || {};
  const eventName = event || 'unknown';
  const apiKey = req.headers['x-api-key'] || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || null;

  log.info('event', {
    event: eventName,
    timestamp: timestamp || new Date().toISOString(),
    metadata: metadata || {},
  });

  const db = tryGetDb();
  if (db) {
    try {
      db.prepare(
        'INSERT INTO usage_events (event, api_key, metadata, recorded_at) VALUES (?, ?, ?, ?)'
      ).run(
        eventName,
        apiKey ? apiKey.slice(0, 8) + '…' : null,
        JSON.stringify(metadata || {}),
        timestamp || new Date().toISOString()
      );
    } catch (err) {
      log.warn('usage_events insert failed', { error: err.message });
    }
  }

  res.status(200).json({ success: true, message: 'Recorded' });
}

function getSyncStatus(_req, res) {
  const syncStatus = trySyncStatus();
  if (!syncStatus) {
    return res.status(503).json({ success: false, error: 'Sync log unavailable', code: 'SERVICE_UNAVAILABLE' });
  }
  res.json({ success: true, syncStatus });
}

module.exports = { recordUsage, getSyncStatus };
