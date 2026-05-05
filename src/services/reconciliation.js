// Three-tier biometric reconciliation:
// Tier 1: device_user_id → tbl_employees.biometric_device_uid
// Tier 2: employee_name_raw → tbl_employees.biometric_name
// Tier 3: last 3 digits of employee_number → device_user_id
//
// Unresolved = flag and stop. Never auto-create employees.

const { queryWithRetry } = require('../config/db');
const empQ = require('../db/queries/employees');
const bus  = require('../notifications/bus');

async function resolveEmployee(deviceUserId, employeeNameRaw, companyId) {
  // Tier 1
  let employee = await empQ.findByBiometricUid(deviceUserId, companyId);
  if (employee) return { employee, tier: 1 };

  // Tier 2
  if (employeeNameRaw) {
    employee = await empQ.findByBiometricName(employeeNameRaw, companyId);
    if (employee) return { employee, tier: 2 };
  }

  // Tier 3 — last 3 digits of device_user_id matched against employee_number suffix
  const suffix = String(deviceUserId).slice(-3).padStart(3, '0');
  employee = await empQ.findByEmployeeNumberSuffix(suffix, companyId);
  if (employee) return { employee, tier: 3 };

  return { employee: null, tier: null };
}

// Processes all pending raw logs for a company and updates reconciliation_status
async function runReconciliation(companyId) {
  const [logs] = await queryWithRetry(
    `SELECT rdl.log_id, rdl.device_user_id, rdl.employee_name_raw, rdl.record_time
     FROM tbl_raw_device_logs rdl
     JOIN tbl_device d ON d.device_id = rdl.device_id AND d.company_id = ?
     WHERE rdl.reconciliation_status = 'unresolved'
     ORDER BY rdl.record_time ASC`,
    [companyId]
  );

  let resolved = 0, unresolved = 0;

  for (const log of logs) {
    const { employee } = await resolveEmployee(log.device_user_id, log.employee_name_raw, companyId);

    if (employee) {
      await queryWithRetry(
        `UPDATE tbl_raw_device_logs
         SET reconciliation_status = 'resolved', employee_id = ?, updated_at = NOW()
         WHERE log_id = ?`,
        [employee.employee_id, log.log_id]
      );
      resolved++;
    } else {
      await queryWithRetry(
        `UPDATE tbl_raw_device_logs
         SET reconciliation_status = 'unresolvable',
             reconciliation_note = 'No employee match after 3-tier lookup',
             updated_at = NOW()
         WHERE log_id = ?`,
        [log.log_id]
      );
      unresolved++;

      bus.emit('BIOMETRIC_NOT_ENROLLED', {
        logId: log.log_id, deviceUserId: log.device_user_id,
        employeeNameRaw: log.employee_name_raw,
        recordTime: log.record_time, companyId,
      });
    }
  }

  console.log(`✅ [reconcile] company=${companyId} resolved=${resolved} unresolved=${unresolved}`);
  return { resolved, unresolved };
}

// Manually link a device_user_id to an employee (IT Admin action)
async function linkEmployee(logId, employeeId, companyId, userId) {
  const [rows] = await queryWithRetry(
    `SELECT rdl.log_id FROM tbl_raw_device_logs rdl
     JOIN tbl_device d ON d.device_id = rdl.device_id AND d.company_id = ?
     WHERE rdl.log_id = ?`,
    [companyId, logId]
  );
  if (!rows.length) throw Object.assign(new Error('Log not found'), { status: 404 });

  await queryWithRetry(
    `UPDATE tbl_raw_device_logs
     SET reconciliation_status = 'resolved', employee_id = ?,
         reconciliation_note = 'Manually linked', updated_at = NOW()
     WHERE log_id = ?`,
    [employeeId, logId]
  );
}

module.exports = { resolveEmployee, runReconciliation, linkEmployee };
