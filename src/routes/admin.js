const express = require('express');
const { requireAdmin } = require('../middleware/admin');
const { triggerRefresh, getKeyUsageLog } = require('../controllers/adminController');
const { forceEvent } = require('../controllers/eventsController');

const router = express.Router();

router.post('/refresh', requireAdmin, triggerRefresh);
router.get('/keys/:keyId/usage', requireAdmin, getKeyUsageLog);
// US-13.3: inject a synthetic notification event for demos
router.post('/events', requireAdmin, forceEvent);

module.exports = router;
