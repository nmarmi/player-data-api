/**
 * US-10.1: requireLicense checks API keys against the DB api_keys table first,
 * then falls back to the legacy API_LICENSE_KEY / VALID_API_KEYS env vars.
 *
 * US-10.4: On successful DB-key auth, schedules a usage log write after the
 * response finishes and enriches structured log entries with accountId/keyId.
 */
const { findKeyByRaw, touchKey } = require('../db/developerAccounts');
const { logKeyUse } = require('../db/auditLog');
const log = require('../logger').child({ component: 'license' });

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

function getRequestIp(req) {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.get('X-Forwarded-For');
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || null;
}

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
  if (found.status === 'valid') {
    touchKey(found.keyRow.id);
    req.developerAccount = found.account;

    // US-10.4: write usage log after response, never block the request
    const keyId     = found.keyRow.id;
    const accountId = found.account.id;
    const keyTail   = String(keyId).slice(-4); // last 4 chars of id for log cross-ref
    res.on('finish', () => {
      log.info('authed request', {
        accountId,
        keyId: keyTail,
        method: req.method,
        path:   req.path,
        status: res.statusCode,
      });
      logKeyUse({
        keyId,
        accountId,
        path:   req.path,
        method: req.method,
        status: res.statusCode,
        ip:     getRequestIp(req),
      });
    });

    return next();
  }

  if (found.status === 'revoked') {
    return res.status(401).json({ success: false, error: 'API key has been revoked', code: 'KEY_REVOKED' });
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
    if (found.status === 'valid' && found.account.isAdmin) {
      touchKey(found.keyRow.id);
      req.developerAccount = found.account;
      return next();
    }
  }

  return res.status(401).json({ success: false, error: 'Admin access required', code: 'UNAUTHORIZED' });
}

module.exports = { requireLicense, requireAdmin, getKeyFromRequest, getValidKeys };
