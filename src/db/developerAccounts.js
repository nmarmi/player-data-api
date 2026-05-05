const crypto = require('crypto');
const { getDb } = require('./connection');

/** SHA-256 hex of a raw API key — fast, deterministic, suitable for lookup. */
function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Derive a scrypt hash suitable for password storage.
 * Returns "<salt>:<hash>" so the salt travels with the record.
 */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/** Returns true when `password` matches a stored `"<salt>:<hash>"` string. */
function verifyPassword(password, stored) {
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

/**
 * Look up an API key by its raw value.
 * Returns `{ status, keyRow?, account? }`:
 *   status = 'valid'     — key found and not revoked
 *   status = 'revoked'   — key found but revoked
 *   status = 'not_found' — key hash not in DB (or DB unavailable)
 */
function findKeyByRaw(rawKey) {
  try {
    const db = getDb();
    const keyRow = db.prepare(`
      SELECT k.*, a.email, a.is_admin
      FROM   api_keys k
      JOIN   developer_accounts a ON a.id = k.account_id
      WHERE  k.key_hash = ?
    `).get(hashKey(rawKey));

    if (!keyRow) return { status: 'not_found' };
    if (keyRow.revoked_at) return { status: 'revoked', keyRow };
    return {
      status: 'valid',
      keyRow,
      account: { id: keyRow.account_id, email: keyRow.email, isAdmin: Boolean(keyRow.is_admin) },
    };
  } catch (_) {
    return { status: 'not_found' };
  }
}

/** Bump last_used_at for the given key row id. */
function touchKey(keyId) {
  try {
    getDb()
      .prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`)
      .run(keyId);
  } catch (_) {}
}

/**
 * Create a new API key for an account.
 * Returns `{ rawKey, id, label }` — the raw key is never stored.
 */
function createKey(accountId, label = '', ipWhitelist = []) {
  const rawKey = crypto.randomBytes(32).toString('hex');
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO api_keys (account_id, key_hash, label, ip_whitelist)
    VALUES (?, ?, ?, ?)
  `).run(accountId, hashKey(rawKey), label, JSON.stringify(ipWhitelist));
  return { rawKey, id: info.lastInsertRowid, label };
}

/**
 * Create a developer account. Returns the new account row id.
 */
function createAccount(email, password, isAdmin = false) {
  const db = getDb();
  const info = db.prepare(`
    INSERT INTO developer_accounts (email, password_hash, is_admin)
    VALUES (?, ?, ?)
  `).run(email, hashPassword(password), isAdmin ? 1 : 0);
  return info.lastInsertRowid;
}

/**
 * List all active (non-revoked) keys for an account.
 * Never returns the raw key or its hash.
 */
function listKeys(accountId) {
  try {
    const rows = getDb().prepare(`
      SELECT id, label, ip_whitelist, last_used_at, created_at
      FROM   api_keys
      WHERE  account_id = ? AND revoked_at IS NULL
      ORDER  BY created_at DESC
    `).all(accountId);
    return rows.map((r) => ({
      id:          r.id,
      label:       r.label,
      ipWhitelist: JSON.parse(r.ip_whitelist || '[]'),
      lastUsedAt:  r.last_used_at,
      createdAt:   r.created_at,
    }));
  } catch (_) {
    return [];
  }
}

/**
 * Revoke a key by id, scoped to owning account.
 * Returns true when revoked, false when not found or already revoked.
 */
function revokeKeyById(keyId, accountId) {
  try {
    const info = getDb().prepare(`
      UPDATE api_keys
      SET    revoked_at = datetime('now')
      WHERE  id = ? AND account_id = ? AND revoked_at IS NULL
    `).run(keyId, accountId);
    return info.changes > 0;
  } catch (_) {
    return false;
  }
}

/** Returns the account row by email, or null. */
function findAccountByEmail(email) {
  try {
    return getDb().prepare('SELECT * FROM developer_accounts WHERE email = ?').get(email) || null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  hashKey,
  hashPassword,
  verifyPassword,
  findKeyByRaw,
  touchKey,
  createKey,
  listKeys,
  revokeKeyById,
  createAccount,
  findAccountByEmail,
};
