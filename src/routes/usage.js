const express = require('express');
const { requireLicense } = require('../middleware/license');
const { recordUsage } = require('../controllers/usageController');

const router = express.Router();

router.post('/', requireLicense, recordUsage);

module.exports = router;
