const express  = require('express');
const schedSvc = require('../services/schedule');
const { requireRole, requireSubdept } = require('../middleware/scope');
const auditLog = require('../middleware/audit');

const router = express.Router();

// GET /api/schedule/cutoffs
router.get('/cutoffs', async (req, res) => {
  try {
    const data = await schedSvc.getCutoffs(req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/schedule/shifts
router.get('/shifts', async (req, res) => {
  try {
    const data = await schedSvc.getShifts(req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/schedule/slots/:subdept_id
router.get('/slots/:subdept_id', requireSubdept('subdept_id'), async (req, res) => {
  try {
    const data = await schedSvc.getSlots(parseInt(req.params.subdept_id, 10));
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/schedule/:cutoff_id/:subdept_id
router.get('/:cutoff_id/:subdept_id', requireSubdept('subdept_id'), async (req, res) => {
  try {
    const data = await schedSvc.getGrid(
      parseInt(req.params.cutoff_id, 10),
      parseInt(req.params.subdept_id, 10),
      req.user
    );
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/schedule/cell — save single cell
router.post('/cell', requireRole('hr', 'coord', 'super_admin'), auditLog('SAVE_SCHEDULE_CELL', 'tbl_schedule'), async (req, res) => {
  try {
    await schedSvc.saveCell(req.body, req.user);
    res.json({ success: true, message: 'Cell saved' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/schedule/cells — save multiple cells (auto-save batch)
router.post('/cells', requireRole('hr', 'coord', 'super_admin'), auditLog('SAVE_SCHEDULE_CELLS', 'tbl_schedule'), async (req, res) => {
  try {
    const { cells } = req.body;
    if (!Array.isArray(cells)) {
      return res.status(400).json({ success: false, error: 'cells must be an array' });
    }
    await schedSvc.saveCells(cells, req.user);
    res.json({ success: true, message: `${cells.length} cell(s) saved` });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/schedule/:cutoff_id/:subdept_id/submit
router.post('/:cutoff_id/:subdept_id/submit', requireRole('coord', 'hr', 'super_admin'), requireSubdept('subdept_id'), auditLog('SUBMIT_SCHEDULE', 'tbl_cutoff_schedule_status'), async (req, res) => {
  try {
    await schedSvc.submitForReview(
      parseInt(req.params.cutoff_id, 10),
      parseInt(req.params.subdept_id, 10),
      req.user
    );
    res.json({ success: true, message: 'Schedule submitted for Operations Head review' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/schedule/:cutoff_id/:subdept_id/note — Operations Head sign-off
router.post('/:cutoff_id/:subdept_id/note', requireRole('coord', 'hr', 'super_admin'), auditLog('NOTE_SCHEDULE', 'tbl_cutoff_schedule_status'), async (req, res) => {
  try {
    await schedSvc.noteByOpHead(
      parseInt(req.params.cutoff_id, 10),
      parseInt(req.params.subdept_id, 10),
      req.user
    );
    res.json({ success: true, message: 'Schedule signed off' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/schedule/:cutoff_id/:subdept_id/publish — HR Admin publishes
router.post('/:cutoff_id/:subdept_id/publish', requireRole('hr', 'super_admin'), auditLog('PUBLISH_SCHEDULE', 'tbl_cutoff_schedule_status'), async (req, res) => {
  try {
    await schedSvc.publish(
      parseInt(req.params.cutoff_id, 10),
      parseInt(req.params.subdept_id, 10),
      req.user
    );
    res.json({ success: true, message: 'Schedule published' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

module.exports = router;
