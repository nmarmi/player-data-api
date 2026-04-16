/**
 * Admin-level auth middleware.
 *
 * Checks for ADMIN_API_KEY env var first; falls back to API_LICENSE_KEY /
 * VALID_API_KEYS so a single-key deployment doesn't need two separate secrets.
 *
 * Key is read from X-Admin-Key header OR the standard X-API-Key / Bearer token
 * (same as requireLicense, but validated against the admin secret).
 */
const { getKeyFromRequest, getValidKeys } = require('./license');

function getAdminKey() {
  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey) return adminKey.trim();
  // Fall back to the regular license key set so single-key deployments work
  const keys = getValidKeys();
  return keys.length === 1 ? keys[0] : null;
}

function requireAdmin(req, res, next) {
  const adminKey = getAdminKey();
  if (!adminKey) {
    return res.status(500).json({
      success: false,
      error: 'Admin key not configured',
      code: 'ADMIN_NOT_CONFIGURED',
    });
  }

  const provided = req.get('X-Admin-Key') || getKeyFromRequest(req);
  if (!provided || provided !== adminKey) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or missing admin key',
      code: 'UNAUTHORIZED',
    });
  }

  next();
}

module.exports = { requireAdmin };
