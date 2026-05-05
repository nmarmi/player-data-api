const { createAccount, findAccountByEmail, verifyPassword, createKey, listKeys, revokeKeyById, updateKeyWhitelist } = require('../db/developerAccounts');
const { setSession, clearSession } = require('../middleware/session');
const log = require('../logger').child({ component: 'developer' });

const MIN_PASSWORD_LENGTH = 8;

function register(req, res) {
  const { email, password } = req.body || {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Valid email required', code: 'INVALID_EMAIL' });
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      code: 'WEAK_PASSWORD',
    });
  }

  if (findAccountByEmail(email)) {
    return res.status(409).json({ success: false, error: 'Email already registered', code: 'EMAIL_TAKEN' });
  }

  try {
    const accountId = createAccount(email, password, false);
    log.info('developer registered', { accountId, email });
    setSession(res, { id: accountId, email, isAdmin: false });
    return res.status(201).json({ success: true, account: { id: accountId, email, isAdmin: false } });
  } catch (err) {
    log.error('register failed', { error: err.message });
    return res.status(500).json({ success: false, error: 'Registration failed', code: 'INTERNAL_ERROR' });
  }
}

function login(req, res) {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required', code: 'MISSING_CREDENTIALS' });
  }

  const account = findAccountByEmail(email);
  if (!account) {
    return res.status(401).json({ success: false, error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
  }

  let valid = false;
  try {
    valid = verifyPassword(password, account.password_hash);
  } catch (_) {}

  if (!valid) {
    return res.status(401).json({ success: false, error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
  }

  setSession(res, { id: account.id, email: account.email, isAdmin: Boolean(account.is_admin) });
  log.info('developer login', { accountId: account.id, email: account.email });
  return res.json({
    success: true,
    account: { id: account.id, email: account.email, isAdmin: Boolean(account.is_admin) },
  });
}

function me(req, res) {
  const { id, email, isAdmin } = req.session;
  return res.json({ success: true, account: { id, email, isAdmin } });
}

function logout(req, res) {
  clearSession(res);
  return res.json({ success: true, message: 'Logged out' });
}

function issueKey(req, res) {
  const { id: accountId } = req.session;
  const { label = '', ipWhitelist = [] } = req.body || {};

  if (!Array.isArray(ipWhitelist)) {
    return res.status(400).json({ success: false, error: 'ipWhitelist must be an array', code: 'INVALID_INPUT' });
  }

  try {
    const { rawKey, id, label: savedLabel } = createKey(accountId, label, ipWhitelist);
    log.info('api key created', { accountId, keyId: id, label: savedLabel });
    return res.status(201).json({ success: true, key: rawKey, id, label: savedLabel });
  } catch (err) {
    log.error('key creation failed', { error: err.message });
    return res.status(500).json({ success: false, error: 'Key creation failed', code: 'INTERNAL_ERROR' });
  }
}

function getKeys(req, res) {
  const { id: accountId } = req.session;
  const keys = listKeys(accountId);
  return res.json({ success: true, keys });
}

function deleteKey(req, res) {
  const { id: accountId } = req.session;
  const keyId = Number(req.params.id);

  if (!keyId) {
    return res.status(400).json({ success: false, error: 'Invalid key id', code: 'INVALID_INPUT' });
  }

  const revoked = revokeKeyById(keyId, accountId);
  if (!revoked) {
    return res.status(404).json({ success: false, error: 'Key not found or already revoked', code: 'NOT_FOUND' });
  }

  log.info('api key revoked', { accountId, keyId });
  return res.json({ success: true, message: 'Key revoked' });
}

function patchKey(req, res) {
  const { id: accountId } = req.session;
  const keyId = Number(req.params.id);
  const { ipWhitelist } = req.body || {};

  if (!keyId) {
    return res.status(400).json({ success: false, error: 'Invalid key id', code: 'INVALID_INPUT' });
  }
  if (!Array.isArray(ipWhitelist)) {
    return res.status(400).json({ success: false, error: 'ipWhitelist must be an array', code: 'INVALID_INPUT' });
  }

  const updated = updateKeyWhitelist(keyId, accountId, ipWhitelist);
  if (!updated) {
    return res.status(404).json({ success: false, error: 'Key not found or revoked', code: 'NOT_FOUND' });
  }

  log.info('key whitelist updated', { accountId, keyId, ipWhitelist });
  return res.json({ success: true, id: keyId, ipWhitelist });
}

module.exports = { register, login, me, logout, issueKey, getKeys, deleteKey, patchKey };
