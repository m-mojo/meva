const express  = require('express');
const leaveSvc = require('../services/leave');
const { requireRole } = require('../middleware/scope');
const auditLog = require('../middleware/audit');

const router = express.Router();

// GET /api/leave — my leaves (logged-in employee)
router.get('/', async (req, res) => {
  try {
    const data = await leaveSvc.getMyLeaves(req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/leave/employee/:id — HR views any employee's leaves
router.get('/employee/:id', requireRole('hr', 'super_admin'), async (req, res) => {
  try {
    const data = await leaveSvc.getLeavesByEmployee(parseInt(req.params.id, 10), req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/leave/balances/:employee_id
router.get('/balances/:employee_id', requireRole('hr', 'coord', 'it', 'admin', 'super_admin'), async (req, res) => {
  try {
    const data = await leaveSvc.getBalances(parseInt(req.params.employee_id, 10), req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/leave/pending — HR queue
router.get('/pending', requireRole('hr', 'super_admin'), async (req, res) => {
  try {
    const data = await leaveSvc.getLeavesByStatus('pending', req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/leave — apply for leave
router.post('/', auditLog('APPLY_LEAVE', 'tbl_leave'), async (req, res) => {
  try {
    const data = await leaveSvc.applyLeave(req.body, req.user);
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/leave/:id/approve
router.post('/:id/approve', requireRole('hr', 'super_admin'), auditLog('APPROVE_LEAVE', 'tbl_leave'), async (req, res) => {
  try {
    await leaveSvc.approveLeave(parseInt(req.params.id, 10), req.user);
    res.json({ success: true, message: 'Leave approved' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/leave/:id/deny
router.post('/:id/deny', requireRole('hr', 'super_admin'), auditLog('DENY_LEAVE', 'tbl_leave'), async (req, res) => {
  try {
    await leaveSvc.denyLeave(parseInt(req.params.id, 10), req.user);
    res.json({ success: true, message: 'Leave denied' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

module.exports = router;
