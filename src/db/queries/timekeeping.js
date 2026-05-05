const { queryWithRetry } = require('../../config/db');

async function findByCutoff(cutoffId, companyId, subdeptId = null) {
  const where = ['tk.cutoff_id = ?', 'e.company_id = ?'];
  const params = [cutoffId, companyId];

  if (subdeptId) {
    where.push('e.subdepartment_id = ?');
    params.push(subdeptId);
  }

  const [rows] = await queryWithRetry(
    `SELECT tk.timekeeping_id AS tk_id,
            tk.employee_id, tk.schedule_id, tk.date AS shift_date, tk.segment_order,
            tk.time_in, tk.time_out, tk.total_hours_day, tk.late_minutes,
            tk.undertime_minutes, tk.ot_hours, tk.nd_hours, tk.day_scenario,
            tk.classification_status, tk.anomaly_flag, tk.ot_approval_status,
            tk.undertime_approval_status, tk.is_absent, tk.is_manually_locked,
            tk.recompute_needed, tk.processed_at,
            d.late_hours, d.undertime_hours, d.break_deduct_hours, d.halfday_hours AS half_day_deduct_hours,
            (ad.early_ot_hours + ad.late_ot_hours) AS paid_ot, ad.night_diff_hours AS paid_nd,
            ad.ot_multiplier_snapshot, ad.nd_rate_snapshot,
            e.first_name, e.last_name, e.employee_number,
            ep.position_name, sd.subdepartment_name
     FROM tbl_timekeeping tk
     JOIN tbl_employees e ON e.employee_id = tk.employee_id
     LEFT JOIN tbl_employee_position epos
            ON epos.employee_id = tk.employee_id AND epos.is_primary = TRUE AND epos.is_active = TRUE
     LEFT JOIN tbl_position ep ON ep.position_id = epos.position_id
     LEFT JOIN tbl_subdepartment sd ON sd.subdepartment_id = e.subdepartment_id
     LEFT JOIN tbl_deduction d  ON d.timekeeping_id  = tk.timekeeping_id
     LEFT JOIN tbl_additional ad ON ad.timekeeping_id = tk.timekeeping_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.last_name, e.first_name, tk.date`,
    params
  );
  return rows;
}

async function findByEmployeeDate(employeeId, shiftDate) {
  const [rows] = await queryWithRetry(
    `SELECT * FROM tbl_timekeeping
     WHERE employee_id = ? AND date = ?
     ORDER BY segment_order`,
    [employeeId, shiftDate]
  );
  return rows;
}

async function getPendingRecompute(companyId) {
  const [rows] = await queryWithRetry(
    `SELECT tk.timekeeping_id AS tk_id, tk.employee_id, tk.date AS shift_date
     FROM tbl_timekeeping tk
     JOIN tbl_employees e ON e.employee_id = tk.employee_id
     WHERE tk.recompute_needed = TRUE AND tk.is_manually_locked = FALSE
       AND e.company_id = ?
     ORDER BY tk.date`,
    [companyId]
  );
  return rows;
}

async function upsertRow(data) {
  const [result] = await queryWithRetry(
    `INSERT INTO tbl_timekeeping
       (employee_id, cutoff_id, schedule_id, date, segment_order,
        time_in, time_out, total_hours_day, late_minutes, undertime_minutes,
        ot_hours, nd_hours, day_scenario, classification_status,
        anomaly_flag, ot_approval_status, undertime_approval_status,
        is_absent, has_break, is_manually_locked, recompute_needed,
        processed_at, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, FALSE, NOW(), ?, NOW(), ?, NOW())
     ON DUPLICATE KEY UPDATE
       time_in                   = IF(is_manually_locked, time_in,                   VALUES(time_in)),
       time_out                  = IF(is_manually_locked, time_out,                  VALUES(time_out)),
       total_hours_day           = IF(is_manually_locked, total_hours_day,           VALUES(total_hours_day)),
       late_minutes              = IF(is_manually_locked, late_minutes,              VALUES(late_minutes)),
       undertime_minutes         = IF(is_manually_locked, undertime_minutes,         VALUES(undertime_minutes)),
       ot_hours                  = IF(is_manually_locked, ot_hours,                  VALUES(ot_hours)),
       nd_hours                  = IF(is_manually_locked, nd_hours,                  VALUES(nd_hours)),
       day_scenario              = IF(is_manually_locked, day_scenario,              VALUES(day_scenario)),
       classification_status     = IF(is_manually_locked, classification_status,     VALUES(classification_status)),
       anomaly_flag              = IF(is_manually_locked, anomaly_flag,              VALUES(anomaly_flag)),
       ot_approval_status        = IF(is_manually_locked, ot_approval_status,        VALUES(ot_approval_status)),
       undertime_approval_status = IF(is_manually_locked, undertime_approval_status, VALUES(undertime_approval_status)),
       is_absent                 = IF(is_manually_locked, is_absent,                 VALUES(is_absent)),
       has_break                 = IF(is_manually_locked, has_break,                 VALUES(has_break)),
       processed_at              = IF(is_manually_locked, processed_at,              NOW()),
       recompute_needed          = IF(is_manually_locked, recompute_needed,          FALSE),
       updated_by                = IF(is_manually_locked, updated_by,                VALUES(updated_by)),
       updated_at                = IF(is_manually_locked, updated_at,                NOW())`,
    [
      data.employee_id, data.cutoff_id, data.schedule_id ?? null, data.shift_date,
      data.segment_order ?? 1, data.time_in ?? null, data.time_out ?? null,
      data.total_hours_day ?? 0, data.late_minutes ?? 0, data.undertime_minutes ?? 0,
      data.ot_hours ?? 0, data.nd_hours ?? 0, data.day_scenario ?? 'regular',
      data.classification_status ?? 'unclassified',
      data.anomaly_flag ?? false, data.ot_approval_status ?? null,
      data.undertime_approval_status ?? 'not_required',
      data.is_absent ?? false, data.has_break ?? false,
      data.created_by ?? null, data.created_by ?? null,
    ]
  );
  return result;
}

async function flagAnomaly(tkId, reviewedBy = null) {
  await queryWithRetry(
    `UPDATE tbl_timekeeping
     SET anomaly_flag = TRUE, anomaly_reviewed_by = ?, anomaly_reviewed_at = CASE WHEN ? IS NOT NULL THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE timekeeping_id = ?`,
    [reviewedBy, reviewedBy, tkId]
  );
}

async function lock(tkId, updatedBy) {
  await queryWithRetry(
    `UPDATE tbl_timekeeping SET is_manually_locked = TRUE, updated_by = ?, updated_at = NOW()
     WHERE timekeeping_id = ?`,
    [updatedBy, tkId]
  );
}

async function unlock(tkId, updatedBy) {
  await queryWithRetry(
    `UPDATE tbl_timekeeping SET is_manually_locked = FALSE, updated_by = ?, updated_at = NOW()
     WHERE timekeeping_id = ?`,
    [updatedBy, tkId]
  );
}

// ─── Computation input queries ───────────────────────────────────────────────

async function getScheduleForDay(employeeId, shiftDate) {
  const [rows] = await queryWithRetry(
    `SELECT sc.schedule_id, sc.shift_id, sc.sched_type, sc.is_rest_day,
            sc.flex_schedule, sc.flex_time_in, sc.flex_time_out,
            sc.continuation_shift_id,
            sh.time_in AS sched_time_in, sh.time_out AS sched_time_out,
            sh.crosses_midnight, sh.is_graveyard, sh.has_break,
            cont.time_in  AS cont_time_in,  cont.time_out AS cont_time_out,
            cont.crosses_midnight AS cont_crosses_midnight,
            cont.is_graveyard     AS cont_is_graveyard,
            cont.has_break        AS cont_has_break
     FROM tbl_schedule sc
     LEFT JOIN tbl_shift sh   ON sh.shift_id   = sc.shift_id
     LEFT JOIN tbl_shift cont ON cont.shift_id = sc.continuation_shift_id
     WHERE sc.employee_id = ? AND sc.date = ? AND sc.is_draft = FALSE
     LIMIT 1`,
    [employeeId, shiftDate]
  );
  return rows[0] || null;
}

async function getPunchesForDay(employeeId, shiftDate) {
  const [rows] = await queryWithRetry(
    `SELECT new_state, record_time FROM tbl_raw_device_logs
     WHERE employee_id = ? AND shift_date = ? AND reconciliation_status = 'resolved'
     ORDER BY record_time ASC`,
    [employeeId, shiftDate]
  );
  return rows;
}

async function getCutoffById(cutoffId) {
  const [rows] = await queryWithRetry(
    `SELECT start_date, end_date, is_exported FROM tbl_cutoff_period
     WHERE cutoff_id = ? LIMIT 1`,
    [cutoffId]
  );
  return rows[0] || null;
}

async function getActiveEmployees(companyId) {
  const [rows] = await queryWithRetry(
    `SELECT employee_id FROM tbl_employees
     WHERE company_id = ? AND is_active = TRUE`,
    [companyId]
  );
  return rows;
}

async function writeDeduction(employeeId, shiftDate, segmentOrder, lateHours, undertimeHours, breakDeductHours) {
  await queryWithRetry(
    `INSERT INTO tbl_deduction
       (timekeeping_id, cutoff_id, date, late_hours, undertime_hours, break_deduct_hours, halfday_hours, created_at)
     SELECT timekeeping_id, cutoff_id, date, ?, ?, ?, 0, NOW()
     FROM tbl_timekeeping
     WHERE employee_id = ? AND date = ? AND segment_order = ?
     ON DUPLICATE KEY UPDATE
       late_hours = VALUES(late_hours), undertime_hours = VALUES(undertime_hours),
       break_deduct_hours = VALUES(break_deduct_hours), updated_at = NOW()`,
    [lateHours, undertimeHours, breakDeductHours, employeeId, shiftDate, segmentOrder]
  );
}

async function writeAdditional(employeeId, shiftDate, segmentOrder, earlyOtHours, lateOtHours, ndHours, otRate, ndRate) {
  await queryWithRetry(
    `INSERT INTO tbl_additional
       (timekeeping_id, cutoff_id, early_ot_hours, late_ot_hours, night_diff_hours,
        ot_multiplier_snapshot, nd_rate_snapshot, created_at)
     SELECT timekeeping_id, cutoff_id, ?, ?, ?, ?, ?, NOW()
     FROM tbl_timekeeping
     WHERE employee_id = ? AND date = ? AND segment_order = ?
     ON DUPLICATE KEY UPDATE
       early_ot_hours = VALUES(early_ot_hours), late_ot_hours = VALUES(late_ot_hours),
       night_diff_hours = VALUES(night_diff_hours),
       ot_multiplier_snapshot = VALUES(ot_multiplier_snapshot),
       nd_rate_snapshot = VALUES(nd_rate_snapshot), updated_at = NOW()`,
    [earlyOtHours, lateOtHours, ndHours, otRate, ndRate, employeeId, shiftDate, segmentOrder]
  );
}

// ─── Config helpers (D1 — moved from services/timekeeping.js) ────────────────

async function getPunchConfig(companyId) {
  const [rows] = await queryWithRetry(
    `SELECT grace_period_minutes, early_ot_threshold_minutes, late_ot_threshold_minutes,
            break_deduct_hours, break_deduct_threshold_hours, break_deduction_enabled,
            break_applies_to_graveyard, nd_window_start, nd_window_end
     FROM tbl_punch_config WHERE company_id = ? LIMIT 1`,
    [companyId]
  );
  return rows[0] || {};
}

async function getRateConfig(companyId, shiftDate) {
  const [rows] = await queryWithRetry(
    `SELECT * FROM tbl_rate_config
     WHERE company_id = ? AND effective_date <= ?
     ORDER BY effective_date DESC LIMIT 1`,
    [companyId, shiftDate]
  );
  return rows[0] || {};
}

async function getHoliday(companyId, date) {
  const [rows] = await queryWithRetry(
    `SELECT holiday_id, holiday_name, holiday_type FROM tbl_holiday
     WHERE company_id = ? AND holiday_date = ? LIMIT 1`,
    [companyId, date]
  );
  return rows[0] || null;
}

async function getCurrentCutoff(companyId, date) {
  const [rows] = await queryWithRetry(
    `SELECT cutoff_id FROM tbl_cutoff_period
     WHERE company_id = ? AND start_date <= ? AND end_date >= ? AND is_active = TRUE LIMIT 1`,
    [companyId, date, date]
  );
  return rows[0]?.cutoff_id || null;
}

module.exports = {
  findByCutoff, findByEmployeeDate, getPendingRecompute,
  upsertRow, flagAnomaly, lock, unlock,
  getPunchConfig, getRateConfig, getHoliday, getCurrentCutoff,
  getScheduleForDay, getPunchesForDay, getCutoffById, getActiveEmployees,
  writeDeduction, writeAdditional,
};
