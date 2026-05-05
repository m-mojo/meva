const { queryWithRetry } = require('../../config/db');

async function getGrid(cutoffId, subdeptId) {
  const [rows] = await queryWithRetry(
    `SELECT sc.schedule_id, sc.employee_id, sc.slot_id, sc.station_id,
            sc.shift_id, sc.date, sc.night_diff, sc.is_ot, sc.sched_type,
            sc.is_rest_day, sc.flex_schedule, sc.continuation_shift_id,
            sc.continuation_time_in, sc.continuation_time_out,
            sc.override_effective_date, sc.position_id, sc.is_draft,
            e.first_name, e.last_name, e.employee_number,
            sh.shift_name, sh.time_in AS preset_in, sh.time_out AS preset_out,
            sh.is_graveyard, sh.crosses_midnight AS preset_crosses_midnight,
            sh.has_break, sh.total_hours,
            sl.slot_label, sl.slot_order
     FROM tbl_schedule sc
     JOIN tbl_employees e ON e.employee_id = sc.employee_id
     LEFT JOIN tbl_shift sh ON sh.shift_id = sc.shift_id
     LEFT JOIN tbl_shift_slot sl ON sl.slot_id = sc.slot_id
     WHERE sc.cutoff_id = ? AND sc.subdepartment_id = ?
     ORDER BY sl.slot_order, e.last_name, e.first_name, sc.date`,
    [cutoffId, subdeptId]
  );
  return rows;
}

async function upsertCell(data, userId) {
  const [result] = await queryWithRetry(
    `INSERT INTO tbl_schedule
       (cutoff_id, employee_id, subdepartment_id, slot_id, station_id, shift_id, date,
        night_diff, is_ot, sched_type, is_rest_day, flex_schedule,
        continuation_shift_id, continuation_time_in, continuation_time_out,
        position_id, is_draft,
        created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW())
     ON DUPLICATE KEY UPDATE
       slot_id = VALUES(slot_id), station_id = VALUES(station_id), shift_id = VALUES(shift_id),
       night_diff = VALUES(night_diff), is_ot = VALUES(is_ot),
       sched_type = VALUES(sched_type), is_rest_day = VALUES(is_rest_day),
       flex_schedule = VALUES(flex_schedule), continuation_shift_id = VALUES(continuation_shift_id),
       continuation_time_in = VALUES(continuation_time_in),
       continuation_time_out = VALUES(continuation_time_out),
       position_id = VALUES(position_id),
       is_draft = VALUES(is_draft), updated_by = VALUES(updated_by), updated_at = NOW()`,
    [
      data.cutoff_id, data.employee_id, data.subdepartment_id, data.slot_id ?? null,
      data.station_id ?? null, data.shift_id ?? null, data.sched_date ?? data.date,
      data.night_diff ?? false, data.is_ot ?? false, data.sched_type ?? null,
      data.is_rest_day ?? false, data.flex_schedule ?? 0, data.continuation_shift_id ?? null,
      data.continuation_time_in ?? null, data.continuation_time_out ?? null,
      data.position_id ?? null, data.is_draft ?? true,
      userId, userId,
    ]
  );
  return result;
}

async function getStatus(cutoffId, subdeptId) {
  const [rows] = await queryWithRetry(
    `SELECT css.*, u.username AS noted_by_username
     FROM tbl_cutoff_schedule_status css
     LEFT JOIN tbl_user_account u ON u.user_acc_id = css.noted_by_user_id
     WHERE css.cutoff_id = ? AND css.subdepartment_id = ? LIMIT 1`,
    [cutoffId, subdeptId]
  );
  return rows[0] || null;
}

async function setStatus(cutoffId, subdeptId, scheduleState, userId) {
  await queryWithRetry(
    `INSERT INTO tbl_cutoff_schedule_status
       (cutoff_id, subdepartment_id, schedule_state, updated_by, updated_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE schedule_state = VALUES(schedule_state),
       updated_by = VALUES(updated_by), updated_at = NOW()`,
    [cutoffId, subdeptId, scheduleState, userId]
  );
}

async function noteByOpHead(cutoffId, subdeptId, userId) {
  const [result] = await queryWithRetry(
    `UPDATE tbl_cutoff_schedule_status
     SET noted_by_user_id = ?, noted_at = NOW(), updated_by = ?, updated_at = NOW()
     WHERE cutoff_id = ? AND subdepartment_id = ?`,
    [userId, userId, cutoffId, subdeptId]
  );
  return result.affectedRows;
}

async function publish(cutoffId, subdeptId, userId, source = 'manual') {
  const [result] = await queryWithRetry(
    `UPDATE tbl_cutoff_schedule_status
     SET is_published = TRUE, publish_source = ?, published_by = ?, published_at = NOW(),
         schedule_state = 'locked', updated_by = ?, updated_at = NOW()
     WHERE cutoff_id = ? AND subdepartment_id = ? AND noted_by_user_id IS NOT NULL`,
    [source, userId, userId, cutoffId, subdeptId]
  );
  return result.affectedRows;
}

async function getShifts(companyId) {
  const [rows] = await queryWithRetry(
    `SELECT shift_id, shift_name, time_in, time_out, total_hours, crosses_midnight,
            is_graveyard, has_break, company_id
     FROM tbl_shift
     WHERE company_id = ? OR company_id IS NULL
     ORDER BY shift_name`,
    [companyId]
  );
  return rows;
}

async function getSlots(subdeptId) {
  const [rows] = await queryWithRetry(
    `SELECT slot_id, slot_label, slot_order, is_reliever
     FROM tbl_shift_slot WHERE subdepartment_id = ? ORDER BY slot_order`,
    [subdeptId]
  );
  return rows;
}

async function getCutoffs(companyId, limit = 6) {
  const [rows] = await queryWithRetry(
    `SELECT cutoff_id, start_date, end_date, is_active, is_exported
     FROM tbl_cutoff_period WHERE company_id = ?
     ORDER BY start_date DESC LIMIT ?`,
    [companyId, limit]
  );
  return rows;
}

module.exports = {
  getGrid, upsertCell, getStatus, setStatus, noteByOpHead, publish,
  getShifts, getSlots, getCutoffs,
};
