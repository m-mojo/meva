const express     = require('express');
const devSvc      = require('../services/devices');
const reconcile   = require('../services/reconciliation');
const bus         = require('../notifications/bus');
const sseTickets  = require('../notifications/sseTickets');
const { requireRole } = require('../middleware/scope');
const auditLog    = require('../middleware/audit');

const router = express.Router();

// GET /api/devices — list devices for company
router.get('/', requireRole('hr', 'it', 'super_admin'), async (req, res) => {
  try {
    const data = await devSvc.list(req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/devices/:id/logs — recent punch log feed
router.get('/:id/logs', requireRole('hr', 'it', 'super_admin'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '100', 10);
    const data  = await devSvc.recentLogs(parseInt(req.params.id, 10), limit, req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/devices/unresolved — punch logs that couldn't be matched to an employee
router.get('/unresolved', requireRole('hr', 'it', 'super_admin'), async (req, res) => {
  try {
    const data = await devSvc.unresolvedLogs(req.user);
    res.json({ success: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/devices/reconcile — run reconciliation pass
router.post('/reconcile', requireRole('hr', 'it', 'super_admin'), auditLog('RUN_RECONCILIATION', 'tbl_raw_device_logs'), async (req, res) => {
  try {
    const result = await reconcile.runReconciliation(req.user.company_id);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/devices/logs/:log_id/link — manually link unresolved log to employee
router.post('/logs/:log_id/link', requireRole('it', 'hr', 'super_admin'), auditLog('LINK_DEVICE_LOG', 'tbl_raw_device_logs'), async (req, res) => {
  try {
    const { employee_id } = req.body;
    if (!employee_id) return res.status(400).json({ success: false, error: 'employee_id required' });

    await reconcile.linkEmployee(
      parseInt(req.params.log_id, 10),
      employee_id,
      req.user.company_id,
      req.user.user_id
    );
    res.json({ success: true, message: 'Log linked to employee' });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/devices/:id/command — queue a device command
router.post('/:id/command', requireRole('it', 'super_admin'), auditLog('QUEUE_DEVICE_COMMAND', 'tbl_device_command_queue'), async (req, res) => {
  try {
    const cmdId = await devSvc.queueCommand(parseInt(req.params.id, 10), req.body, req.user);
    res.status(201).json({ success: true, data: { command_id: cmdId } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/devices/feed/token — issue a short-lived SSE ticket (30s, single-use)
// Browser EventSource cannot send Authorization headers, so callers exchange their
// JWT for a ticket here, then open the SSE stream with ?token=<ticket>.
router.post('/feed/token', requireRole('hr', 'it', 'super_admin'), (req, res) => {
  const token = sseTickets.issue(req.user.user_id, req.user.company_id);
  res.json({ success: true, data: { token } });
});

// GET /api/devices/feed — SSE live punch feed (fallback for non-socket clients)
// Requires a valid one-time ticket from POST /feed/token (replaces Bearer header,
// which EventSource does not support).
router.get('/feed', (req, res) => {
  const ticket = sseTickets.consume(req.query.token);
  if (!ticket) {
    return res.status(401).json({ success: false, error: 'Valid SSE ticket required' });
  }

  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();

  // Replay ring buffer for new connections; socket.io handles ongoing real-time push
  for (const evt of bus.getBuffer('PUNCH_RECEIVED')) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }

  const interval = setInterval(() => res.write(': ping\n\n'), 30_000);
  req.on('close', () => clearInterval(interval));
});

module.exports = router;
