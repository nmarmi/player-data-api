const express = require('express');
const { requireLicense } = require('../middleware/license');
const { recordUsage, getSyncStatus } = require('../controllers/usageController');

const router = express.Router();

router.get('/sync-status', requireLicense, getSyncStatus);
router.post('/', requireLicense, recordUsage);

module.exports = router;
