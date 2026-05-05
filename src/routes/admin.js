const express = require('express');
const { requireAdmin } = require('../middleware/admin');
const { triggerRefresh, getKeyUsageLog } = require('../controllers/adminController');

const router = express.Router();

router.post('/refresh', requireAdmin, triggerRefresh);
router.get('/keys/:keyId/usage', requireAdmin, getKeyUsageLog);

module.exports = router;
