// Auth routes — login does not require auth middleware (applied in app.js for /api/*)
// We selectively skip auth for POST /login by mounting this router before auth in app.js
// Actually: app.js applies auth globally to /api; login must be outside /api or use a bypass.
// SOLUTION: POST /api/auth/login is excluded from auth check via a whitelist in app.js.
// For now, we handle it here and note the bypass in app.js.

const express = require('express');
const authSvc = require('../services/auth');
const { requireRole } = require('../middleware/scope');
const auditLog = require('../middleware/audit');

const router = express.Router();

// POST /api/auth/login — public (no auth token required)
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, error: 'username and password required' });
    }
    const result = await authSvc.login(username, password);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/auth/suggest-role?position=<name> — helper for UI to preview role before user creation
router.get('/suggest-role', requireRole('super_admin'), (req, res) => {
  const suggested_role = authSvc.suggestRoleByPosition(req.query.position);
  res.json({ success: true, data: { suggested_role } });
});

// POST /api/auth/users — super_admin only
router.post('/users', requireRole('super_admin'), auditLog('CREATE_USER'), async (req, res) => {
  try {
    const user = await authSvc.createUser(req.body, req.user);
    res.status(201).json({ success: true, data: user });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// PUT /api/auth/users/:id/scope
router.put('/users/:id/scope', requireRole('super_admin'), auditLog('UPDATE_USER_SCOPE', 'tbl_user_scope'), async (req, res) => {
  try {
    await authSvc.updateScope(parseInt(req.params.id, 10), req.body.subdept_ids || [], req.user);
    res.json({ success: true, message: 'Scope updated' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// DELETE /api/auth/users/:id
router.delete('/users/:id', requireRole('super_admin'), auditLog('DEACTIVATE_USER'), async (req, res) => {
  try {
    await authSvc.deactivateUser(parseInt(req.params.id, 10), req.user);
    res.json({ success: true, message: 'User deactivated' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

module.exports = router;
