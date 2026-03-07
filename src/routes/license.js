const express = require('express');
const { requireLicense } = require('../middleware/license');
const { checkLicense } = require('../controllers/licenseController');

const router = express.Router();

router.get('/check', requireLicense, checkLicense);

module.exports = router;
