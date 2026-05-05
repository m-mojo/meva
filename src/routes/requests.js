const express = require('express');
const reqSvc  = require('../services/requests');
const { requireRole } = require('../middleware/scope');
const auditLog = require('../middleware/audit');

const router = express.Router();

// GET /api/requests — pending queue (HR sees all; coord sees their subdept)
router.get('/', requireRole('hr', 'coord', 'super_admin'), async (req, res) => {
  try {
    const data = await reqSvc.list(req.query, req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/requests/:id
router.get('/:id', requireRole('hr', 'coord', 'it', 'admin', 'super_admin'), async (req, res) => {
  try {
    const data = await reqSvc.get(parseInt(req.params.id, 10), req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/requests — submit a form (OT, leave, punch correction, shift swap)
router.post('/', requireRole('hr', 'coord', 'it', 'super_admin'), auditLog('SUBMIT_FORM', 'tbl_form_upload'), async (req, res) => {
  try {
    const data = await reqSvc.submit(req.body, req.user);
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/requests/:id/approve — HR Admin approval
router.post('/:id/approve', requireRole('hr', 'super_admin'), auditLog('APPROVE_FORM', 'tbl_form_upload'), async (req, res) => {
  try {
    await reqSvc.approve(parseInt(req.params.id, 10), req.user);
    res.json({ success: true, message: 'Form approved' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/requests/:id/deny
router.post('/:id/deny', requireRole('hr', 'super_admin'), auditLog('DENY_FORM', 'tbl_form_upload'), async (req, res) => {
  try {
    await reqSvc.deny(parseInt(req.params.id, 10), req.user);
    res.json({ success: true, message: 'Form denied' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

module.exports = router;
