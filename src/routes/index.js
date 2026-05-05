const express = require('express');
const router  = express.Router();

router.use('/auth',        require('./auth'));
router.use('/employees',   require('./employees'));
router.use('/schedule',    require('./schedule'));
router.use('/timekeeping', require('./timekeeping'));
router.use('/leave',       require('./leave'));
router.use('/requests',    require('./requests'));
router.use('/devices',     require('./devices'));
router.use('/reports',     require('./reports'));

module.exports = router;
