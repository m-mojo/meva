const { queryWithRetry } = require('../../config/db');

async function findAll(companyId) {
  const [rows] = await queryWithRetry(
    `SELECT d.device_id, d.serial_number, d.device_name, d.ip_address, d.device_port,
            d.company_id, d.location, d.is_active,
            ds.last_stamp, ds.force_full_sync, ds.updated_at AS last_sync_at
     FROM tbl_device d
     LEFT JOIN tbl_device_sync ds ON ds.serial_number = d.serial_number
     WHERE d.company_id = ?`,
    [companyId]
  );
  return rows;
}

async function findById(deviceId, companyId) {
  const [rows] = await queryWithRetry(
    `SELECT d.*, ds.last_stamp, ds.force_full_sync, ds.updated_at AS last_sync_at
     FROM tbl_device d
     LEFT JOIN tbl_device_sync ds ON ds.serial_number = d.serial_number
     WHERE d.device_id = ? AND d.company_id = ?`,
    [deviceId, companyId]
  );
  return rows[0] || null;
}

async function getRecentLogs(deviceId, companyId, limit = 100) {
  const [rows] = await queryWithRetry(
    `SELECT rdl.log_id, rdl.device_user_id, rdl.record_time, rdl.state, rdl.new_state,
            rdl.shift_date, rdl.reconciliation_status, rdl.reconciliation_note,
            e.first_name, e.last_name, e.employee_number
     FROM tbl_raw_device_logs rdl
     LEFT JOIN tbl_employees e ON e.biometric_device_uid = rdl.device_user_id
                               AND e.company_id = ?
     WHERE rdl.device_id = ?
     ORDER BY rdl.record_time DESC
     LIMIT ?`,
    [companyId, deviceId, limit]
  );
  return rows;
}

async function getUnresolvedLogs(companyId, limit = 200) {
  const [rows] = await queryWithRetry(
    `SELECT rdl.log_id, rdl.device_id, rdl.device_user_id, rdl.record_time,
            rdl.new_state, rdl.shift_date, rdl.reconciliation_status, rdl.reconciliation_note,
            d.serial_number, d.device_name
     FROM tbl_raw_device_logs rdl
     JOIN tbl_device d ON d.device_id = rdl.device_id AND d.company_id = ?
     WHERE rdl.reconciliation_status IN ('unresolved', 'fixable')
     ORDER BY rdl.record_time DESC
     LIMIT ?`,
    [companyId, limit]
  );
  return rows;
}

async function queueCommand({ deviceId, commandType, targetEmployeeId, targetDeviceUserId, commandData, createdBy }) {
  const [result] = await queryWithRetry(
    `INSERT INTO tbl_device_command_queue
       (device_id, command_type, target_employee_id, target_device_user_id,
        command_data, status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, NOW())`,
    [deviceId, commandType, targetEmployeeId ?? null, targetDeviceUserId ?? null,
     commandData ? JSON.stringify(commandData) : null, createdBy ?? null]
  );
  return result.insertId;
}

async function resetStaleSentCommands(stalePastMinutes = 10) {
  const [result] = await queryWithRetry(
    `UPDATE tbl_device_command_queue
     SET status = 'pending', retry_count = retry_count + 1, sent_at = NULL
     WHERE status = 'sent' AND sent_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
    [stalePastMinutes]
  );
  return result.affectedRows;
}

module.exports = {
  findAll, findById, getRecentLogs, getUnresolvedLogs,
  queueCommand, resetStaleSentCommands,
};
