// ADMS push endpoints — mounted BEFORE auth middleware (device cannot authenticate)
// Device protocol: GET /iclock/cdata (heartbeat) → GET /iclock/getrequest (commands)
//                  → POST /iclock/devicecmd (ack) + POST /iclock/attendance (punch push)
const express            = require('express');
const { queryWithRetry } = require('../config/db');
const { resolveLogType } = require('./direction');
const bus                = require('../notifications/bus');

const router = express.Router();

// GET /iclock/cdata — heartbeat; device sends serial, server responds with last stamp
router.get('/iclock/cdata', async (req, res) => {
  const serial = req.query.SN;
  if (!serial) return res.status(400).send('ERROR: Missing SN');

  const [rows] = await queryWithRetry(
    `SELECT last_stamp FROM tbl_device_sync WHERE serial_number = ? LIMIT 1`,
    [serial]
  ).catch(() => [[]]);

  const stamp = rows[0]?.last_stamp ?? 0;
  res.set('Content-Type', 'text/plain');
  res.send(`OK\nStamp=${stamp}`);
});

// GET /iclock/getrequest — device polls for next pending command
router.get('/iclock/getrequest', async (req, res) => {
  const serial = req.query.SN;
  if (!serial) return res.send('OK');

  const [deviceRows] = await queryWithRetry(
    `SELECT device_id FROM tbl_device WHERE serial_number = ? LIMIT 1`,
    [serial]
  ).catch(() => [[]]);

  const deviceId = deviceRows[0]?.device_id;
  if (!deviceId) return res.send('OK');

  const [cmds] = await queryWithRetry(
    `SELECT command_id, command_type, command_data FROM tbl_device_command_queue
     WHERE device_id = ? AND status = 'pending' ORDER BY command_id ASC LIMIT 1`,
    [deviceId]
  );

  if (!cmds.length) return res.send('OK');

  const cmd = cmds[0];
  await queryWithRetry(
    `UPDATE tbl_device_command_queue SET status = 'sent', sent_at = NOW() WHERE command_id = ?`,
    [cmd.command_id]
  );

  const payload = cmd.command_data ? JSON.parse(cmd.command_data) : {};
  res.set('Content-Type', 'text/plain');
  res.send(`C:${cmd.command_id}:${cmd.command_type} ${JSON.stringify(payload)}`);
});

// POST /iclock/devicecmd — device reports command execution result
router.post('/iclock/devicecmd', async (req, res) => {
  const cmdId = parseInt(req.body?.ID ?? req.body?.id ?? 0, 10);
  if (cmdId) {
    await queryWithRetry(
      `UPDATE tbl_device_command_queue
       SET status = 'acknowledged', acknowledged_at = NOW() WHERE command_id = ?`,
      [cmdId]
    ).catch(() => {});
  }
  res.send('OK');
});

// POST /iclock/attendance — device pushes attendance batch (JSON or tab-delimited)
router.post('/iclock/attendance', (req, res) => handlePush(req, res));

// POST /iclock/cdata — legacy raw format, same handling
router.post('/iclock/cdata', (req, res) => handlePush(req, res));

async function handlePush(req, res) {
  const serial = req.query.SN;
  if (!serial) return res.status(400).send('ERROR: Missing SN');

  const [deviceRows] = await queryWithRetry(
    `SELECT device_id, company_id FROM tbl_device WHERE serial_number = ? AND is_active = TRUE LIMIT 1`,
    [serial]
  ).catch(() => [[]]);

  const device = deviceRows[0];
  if (!device) return res.status(404).send('ERROR: Unknown device');

  const { device_id: deviceId, company_id: companyId } = device;

  let records = [];
  if (Array.isArray(req.body)) {
    records = req.body;
  } else if (typeof req.body === 'string') {
    // Tab-delimited: userId \t \t attTime \t \t inOutStatus
    records = req.body.trim().split('\n').map(line => {
      const parts = line.split('\t');
      return { userId: parts[0], attTime: parts[2], inOutStatus: parts[4] };
    }).filter(r => r.userId && r.attTime);
  }

  // Must process chronologically — direction algorithm state depends on order
  records.sort((a, b) => new Date(a.attTime) - new Date(b.attTime));

  for (const record of records) {
    const deviceUserId = String(record.userId ?? '');
    const recordTime   = new Date(record.attTime ?? '');
    const rawState     = String(record.inOutStatus ?? '');

    if (!deviceUserId || isNaN(recordTime)) continue;

    const [dup] = await queryWithRetry(
      `SELECT COUNT(*) AS cnt FROM tbl_raw_device_logs
       WHERE device_id = ? AND device_user_id = ? AND record_time = ?`,
      [deviceId, deviceUserId, recordTime]
    );
    if (dup[0].cnt > 0) continue;

    const { direction, shiftDate } = await resolveLogType(deviceUserId, recordTime, companyId);
    if (direction === null) continue;

    const employeeNameRaw = String(record.name ?? record.userName ?? '');

    await queryWithRetry(
      `INSERT INTO tbl_raw_device_logs
         (device_id, device_user_id, employee_name_raw, record_time, state, new_state,
          shift_date, reconciliation_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'unresolved', NOW())`,
      [deviceId, deviceUserId, employeeNameRaw, recordTime, rawState, direction, shiftDate]
    );

    bus.emit('PUNCH_RECEIVED', {
      deviceId,
      deviceUserId,
      recordTime: recordTime.toISOString(),
      direction,
      shiftDate,
    });
  }

  res.send('OK');
}

module.exports = router;
