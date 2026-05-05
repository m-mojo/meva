const express  = require('express');
const tkSvc    = require('../services/timekeeping');
const { requireRole, requireSubdept } = require('../middleware/scope');
const auditLog = require('../middleware/audit');

const router = express.Router();

// GET /api/timekeeping/:cutoff_id
// coord must supply ?subdept_id= and must have scope for it; hr/admin/super_admin see all
router.get('/:cutoff_id', requireRole('hr', 'coord', 'admin', 'super_admin'), requireSubdept('subdept_id'), async (req, res) => {
  try {
    const subdeptId = req.query.subdept_id ? parseInt(req.query.subdept_id, 10) : null;

    if (req.user.role === 'coord' && !subdeptId) {
      return res.status(400).json({ success: false, error: 'subdept_id required' });
    }

    const data = await tkSvc.listByCutoff(
      parseInt(req.params.cutoff_id, 10),
      req.user.company_id,
      subdeptId
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/timekeeping/compute/:cutoff_id — HR triggers full cutoff computation
router.post('/compute/:cutoff_id', requireRole('hr', 'super_admin'), auditLog('COMPUTE_CUTOFF', 'tbl_timekeeping'), async (req, res) => {
  try {
    const result = await tkSvc.computeCutoff(
      parseInt(req.params.cutoff_id, 10),
      req.user.company_id
    );
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/timekeeping/recompute — process all rows with recompute_needed = TRUE
router.post('/recompute', requireRole('hr', 'super_admin'), auditLog('RECOMPUTE_PENDING', 'tbl_timekeeping'), async (req, res) => {
  try {
    const result = await tkSvc.runPendingRecompute(req.user.company_id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/timekeeping/lock/:tk_id — HR locks a row from recomputation
router.post('/lock/:tk_id', requireRole('hr', 'super_admin'), auditLog('LOCK_TK_ROW', 'tbl_timekeeping'), async (req, res) => {
  try {
    await tkSvc.lockRow(parseInt(req.params.tk_id, 10), req.user.user_id);
    res.json({ success: true, message: 'Row locked' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/timekeeping/unlock/:tk_id — HR removes manual lock
router.post('/unlock/:tk_id', requireRole('hr', 'super_admin'), auditLog('UNLOCK_TK_ROW', 'tbl_timekeeping'), async (req, res) => {
  try {
    await tkSvc.unlockRow(parseInt(req.params.tk_id, 10), req.user.user_id);
    res.json({ success: true, message: 'Row unlocked' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

module.exports = router;
