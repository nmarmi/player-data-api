const log = require('../logger').child({ component: 'seedAdmin' });
const { createAccount, createKey, findAccountByEmail } = require('./developerAccounts');

/**
 * US-10.1: Seed a bootstrap admin developer account on first start.
 *
 * Config via env:
 *   ADMIN_EMAIL     — default: admin@localhost
 *   ADMIN_PASSWORD  — default: changeme (warn loudly if unchanged)
 *
 * The generated API key is printed to the log once. It is never stored in
 * plain text — only its SHA-256 hash is persisted.
 */
function seedAdmin() {
  try {
    const email = process.env.ADMIN_EMAIL || 'admin@localhost';
    const password = process.env.ADMIN_PASSWORD || 'changeme';

    if (findAccountByEmail(email)) {
      return; // already seeded
    }

    const accountId = createAccount(email, password, true);
    const { rawKey, id: keyId } = createKey(accountId, 'bootstrap-key');

    if (password === 'changeme') {
      log.warn('bootstrap admin uses default password — set ADMIN_PASSWORD in .env', { email });
    }

    log.info('bootstrap admin account created', {
      email,
      keyId,
      // Show the raw key once at startup so the operator can copy it.
      // It is never stored; only the hash is kept in api_keys.
      apiKey: rawKey,
      note: 'Save this key now — it will not be shown again',
    });
  } catch (err) {
    log.warn('seedAdmin skipped', { reason: err.message });
  }
}

module.exports = { seedAdmin };
