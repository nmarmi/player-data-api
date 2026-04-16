let _getSyncStatus = null;
function trySyncStatus() {
  if (!_getSyncStatus) {
    try { _getSyncStatus = require('../db/syncLog').getSyncStatus; } catch (_) {}
  }
  try { return _getSyncStatus ? _getSyncStatus() : null; } catch (_) { return null; }
}

function recordUsage(req, res) {
  const { event, timestamp, metadata } = req.body || {};
  const payload = {
    event: event || 'unknown',
    timestamp: timestamp || new Date().toISOString(),
    metadata: metadata || {},
  };

  console.log('[usage]', JSON.stringify(payload));
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
