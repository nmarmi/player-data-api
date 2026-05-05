const express = require('express');
const { requireSession } = require('../middleware/session');
const { register, login, me, logout } = require('../controllers/developerController');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', requireSession, me);
router.post('/logout', logout);

module.exports = router;
