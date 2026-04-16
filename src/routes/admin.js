const express = require('express');
const { requireAdmin } = require('../middleware/admin');
const { triggerRefresh } = require('../controllers/adminController');

const router = express.Router();

router.post('/refresh', requireAdmin, triggerRefresh);

module.exports = router;
