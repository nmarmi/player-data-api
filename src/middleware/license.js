/**
 * US-10.1: requireLicense checks API keys against the DB api_keys table first,
 * then falls back to the legacy API_LICENSE_KEY / VALID_API_KEYS env vars.
 *
 * On DB hit: attaches req.developerAccount = { id, email, isAdmin } and bumps
 * api_keys.last_used_at so the audit trail stays current.
 *
 * On env hit: req.developerAccount is left undefined (legacy system key).
 */
const { findKeyByRaw, touchKey } = require('../db/developerAccounts');

function getEnvKeys() {
  const single = process.env.API_LICENSE_KEY;
  if (single) return [single.trim()];
  const list = process.env.VALID_API_KEYS;
  if (list) return list.split(',').map((k) => k.trim()).filter(Boolean);
  return [];
}

function getKeyFromRequest(req) {
  const header = req.get('X-API-Key') || req.get('x-api-key');
  if (header) return header;
  const auth = req.get('Authorization');
  if (auth && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return null;
}

// Legacy alias so callers that imported getValidKeys still work.
const getValidKeys = getEnvKeys;

function requireLicense(req, res, next) {
  const key = getKeyFromRequest(req);

  if (!key) {
    const envKeys = getEnvKeys();
    if (!envKeys.length) {
      return res.status(500).json({ success: false, error: 'License not configured', code: 'LICENSE_NOT_CONFIGURED' });
    }
    return res.status(401).json({ success: false, error: 'Invalid or missing license', code: 'UNAUTHORIZED' });
  }

  // 1. DB lookup — api_keys table (US-10.1)
  const found = findKeyByRaw(key);
  if (found) {
    touchKey(found.keyRow.id);
    req.developerAccount = found.account;
    return next();
  }

  // 2. Legacy env fallback — API_LICENSE_KEY / VALID_API_KEYS
  const envKeys = getEnvKeys();
  if (envKeys.length && envKeys.includes(key)) {
    return next();
  }

  // No key source configured at all
  if (!envKeys.length) {
    return res.status(500).json({ success: false, error: 'License not configured', code: 'LICENSE_NOT_CONFIGURED' });
  }

  return res.status(401).json({ success: false, error: 'Invalid or missing license', code: 'UNAUTHORIZED' });
}

function requireAdmin(req, res, next) {
  const key = getKeyFromRequest(req);
  const adminKey = process.env.ADMIN_API_KEY;

  if (adminKey) {
    if (key === adminKey) return next();
    return res.status(401).json({ success: false, error: 'Admin access required', code: 'UNAUTHORIZED' });
  }

  // Fall back to license keys when no dedicated admin key is set
  const envKeys = getEnvKeys();
  if (envKeys.length && key && envKeys.includes(key)) return next();

  // Also allow DB keys belonging to admin accounts
  if (key) {
    const found = findKeyByRaw(key);
    if (found && found.account.isAdmin) {
      touchKey(found.keyRow.id);
      req.developerAccount = found.account;
      return next();
    }
  }

  return res.status(401).json({ success: false, error: 'Admin access required', code: 'UNAUTHORIZED' });
}

module.exports = { requireLicense, requireAdmin, getKeyFromRequest, getValidKeys };
