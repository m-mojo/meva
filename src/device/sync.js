// 10-second ZKLib pull loop — one cycle per device, sequential per device
// Idempotent: cursor only advances after all inserts in a batch succeed
const { queryWithRetry } = require('../config/db');
const UF100              = require('./adapters');
const { resolveLogType } = require('./direction');
const bus                = require('../notifications/bus');
const config             = require('../config/env');

const INTERVAL_MS = 10_000;

// Build device list from env; filter out entries with no serial (unconfigured devices)
const DEVICE_DEFS = [
  { serial: config.device.uth.serial, ip: config.device.uth.ip, port: config.device.port },
  { serial: config.device.ssh.serial, ip: config.device.ssh.ip, port: config.device.port },
].filter(d => d.serial);

async function getDeviceRecord(serial) {
  const [rows] = await queryWithRetry(
    `SELECT device_id, company_id FROM tbl_device WHERE serial_number = ? AND is_active = TRUE LIMIT 1`,
    [serial]
  );
  return rows[0] || null;
}

async function getLastStamp(serial) {
  const [rows] = await queryWithRetry(
    `SELECT last_stamp FROM tbl_device_sync WHERE serial_number = ? LIMIT 1`,
    [serial]
  );
  return rows[0]?.last_stamp ?? 0;
}

async function isDuplicate(deviceId, deviceUserId, recordTime) {
  const [rows] = await queryWithRetry(
    `SELECT COUNT(*) AS cnt FROM tbl_raw_device_logs
     WHERE device_id = ? AND device_user_id = ? AND record_time = ?`,
    [deviceId, deviceUserId, recordTime]
  );
  return rows[0].cnt > 0;
}

async function syncDevice({ serial, ip, port }) {
  const deviceRecord = await getDeviceRecord(serial);
  if (!deviceRecord) {
    console.log(`⚠️  [sync] No tbl_device row for serial ${serial} — skipping`);
    return;
  }

  const { device_id: deviceId, company_id: companyId } = deviceRecord;
  const zk = new UF100({ ip, port, serial });

  try {
    await zk.connect();

    const lastStamp = await getLastStamp(serial);
    const allLogs   = await zk.getAttendances();

    // Only unprocessed records; sort ASC — direction algorithm requires chronological order
    const newLogs = allLogs
      .filter(l => Number(l.userSn ?? l.uid ?? 0) > lastStamp)
      .sort((a, b) => new Date(a.recordTime ?? a.attTime) - new Date(b.recordTime ?? b.attTime));

    if (!newLogs.length) {
      console.log(`🔄 [sync] ${serial} — no new logs`);
      return;
    }

    console.log(`🔄 [sync] ${serial} — ${newLogs.length} new log(s) from stamp ${lastStamp}`);

    let maxStamp = lastStamp;

    for (const log of newLogs) {
      const deviceUserId = String(log.deviceUserId ?? log.userId ?? '');
      const recordTime   = new Date(log.recordTime ?? log.attTime);
      const rawState     = String(log.inOutStatus ?? '');
      const stamp        = Number(log.userSn ?? log.uid ?? 0);

      if (await isDuplicate(deviceId, deviceUserId, recordTime)) {
        console.log(`⚠️  [sync] duplicate — ${deviceUserId} @ ${recordTime.toISOString()}`);
        maxStamp = Math.max(maxStamp, stamp);
        continue;
      }

      const { direction, shiftDate } = await resolveLogType(deviceUserId, recordTime, companyId, deviceId);

      if (direction === null) {
        // Within duplicate window — skip insert, still advance stamp
        maxStamp = Math.max(maxStamp, stamp);
        continue;
      }

      const employeeNameRaw = String(log.name ?? log.userName ?? '');

      await queryWithRetry(
        `INSERT INTO tbl_raw_device_logs
           (device_id, device_user_id, employee_name_raw, record_time, state, new_state,
            shift_date, reconciliation_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unresolved', NOW())`,
        [deviceId, deviceUserId, employeeNameRaw, recordTime, rawState, direction, shiftDate]
      );

      bus.emit('PUNCH_RECEIVED', { deviceId, deviceUserId, recordTime: recordTime.toISOString(), direction, shiftDate });
      maxStamp = Math.max(maxStamp, stamp);
    }

    // Advance cursor only after full batch succeeds.
    // INSERT ... ON DUPLICATE KEY handles first-sync (no existing row) automatically.
    await queryWithRetry(
      `INSERT INTO tbl_device_sync (device_id, serial_number, last_stamp, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE last_stamp = ?, updated_at = NOW()`,
      [deviceId, serial, maxStamp, maxStamp]
    );

    console.log(`✅ [sync] ${serial} — cursor → ${maxStamp}`);

  } catch (err) {
    console.error(`❌ [sync] ${serial} — ${err.message}`);
  } finally {
    await zk.disconnect();
  }
}

function startSync() {
  const run = async () => {
    for (const def of DEVICE_DEFS) {
      await syncDevice(def);
    }
  };

  run();
  return setInterval(run, INTERVAL_MS);
}

module.exports = { startSync };
