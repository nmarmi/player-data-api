const { createAccount, findAccountByEmail, verifyPassword, createKey, findKeyByRaw } = require('../db/developerAccounts');
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

module.exports = { register, login, me, logout };
