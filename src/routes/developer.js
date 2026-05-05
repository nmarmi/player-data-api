const express = require('express');
const { requireSession } = require('../middleware/session');
const { register, login, me, logout, issueKey, getKeys, deleteKey, patchKey } = require('../controllers/developerController');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', requireSession, me);
router.post('/logout', logout);

// US-10.3: key management (session-gated)
router.post('/keys', requireSession, issueKey);
router.get('/keys', requireSession, getKeys);
router.patch('/keys/:id', requireSession, patchKey);
router.delete('/keys/:id', requireSession, deleteKey);

module.exports = router;
