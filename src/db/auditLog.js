const { getDb } = require('./connection');

const TTL_DAYS = 30;

/**
 * US-10.4: Write one usage row and prune rows older than TTL_DAYS.
 * Silently swallowed on any DB error so auth never fails due to logging.
 */
function logKeyUse({ keyId, accountId, path, method, status, ip }) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO api_key_usage_log (key_id, account_id, path, method, status, ip)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(keyId, accountId, path, method, status, ip || null);

    // Rolling TTL — delete anything older than 30 days on every write
    db.prepare(`
      DELETE FROM api_key_usage_log
      WHERE at < datetime('now', '-${TTL_DAYS} days')
    `).run();
  } catch (_) {}
}

/**
 * Return recent usage rows for a given key, newest first.
 * @param {number} keyId
 * @param {number} [days=30]
 */
function getKeyUsage(keyId, days = TTL_DAYS) {
  try {
    return getDb().prepare(`
      SELECT id, key_id, account_id, path, method, status, ip, at
      FROM   api_key_usage_log
      WHERE  key_id = ?
        AND  at >= datetime('now', '-${days} days')
      ORDER  BY at DESC
      LIMIT  500
    `).all(keyId);
  } catch (_) {
    return [];
  }
}

module.exports = { logKeyUse, getKeyUsage };
