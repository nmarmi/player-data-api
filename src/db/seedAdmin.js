const log = require('../logger').child({ component: 'seedAdmin' });
const { createAccount, createKey, findAccountByEmail } = require('./developerAccounts');

const DEFAULT_PASSWORD = 'changeme';

/**
 * US-10.1: Seed a bootstrap admin developer account on first start.
 *
 * Config via env:
 *   ADMIN_EMAIL     — default: admin@localhost
 *   ADMIN_PASSWORD  — required in production; in dev defaults to "changeme"
 *
 * In production (`NODE_ENV === 'production'`) the seeder REFUSES to create the
 * admin account when ADMIN_PASSWORD is missing or set to the default — this
 * prevents accidentally booting a public service with a known-bad password.
 *
 * The generated API key is printed to the log once. It is never stored in
 * plain text — only its SHA-256 hash is persisted.
 */
function seedAdmin() {
  try {
    const email    = process.env.ADMIN_EMAIL || 'admin@localhost';
    const rawPassword = process.env.ADMIN_PASSWORD;
    const isProduction = process.env.NODE_ENV === 'production';

    // Production guard: refuse to seed with the default password
    if (isProduction && (!rawPassword || rawPassword === DEFAULT_PASSWORD)) {
      log.error('refusing to seed admin in production without a strong ADMIN_PASSWORD', {
        email,
        hint: 'Set ADMIN_PASSWORD in the deploy environment to something other than "changeme"',
      });
      return;
    }

    const password = rawPassword || DEFAULT_PASSWORD;

    if (findAccountByEmail(email)) {
      return; // already seeded
    }

    const accountId = createAccount(email, password, true);
    const { rawKey, id: keyId } = createKey(accountId, 'bootstrap-key');

    if (password === DEFAULT_PASSWORD) {
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
