const express = require('express');
const { requireLicense } = require('../middleware/license');
const { listPlayers, getPlayerFilters, getPlayerPool } = require('../controllers/playersController');

const router = express.Router();

router.get('/filters', requireLicense, getPlayerFilters);
router.get('/pool', requireLicense, getPlayerPool);
router.get('/', requireLicense, listPlayers);

module.exports = router;
