const { queryWithRetry } = require('../../config/db');

async function findByEmployee(employeeId, companyId) {
  const [rows] = await queryWithRetry(
    `SELECT l.leave_id, l.employee_id, l.leave_type_id, l.cutoff_id, l.end_cutoff_id,
            l.start_date, l.end_date, l.leave_days, l.reason, l.status,
            l.form_upload_id, l.created_at,
            lt.leave_type_name, lt.is_paid,
            cp.start_date AS cutoff_start, cp.end_date AS cutoff_end
     FROM tbl_leave l
     JOIN tbl_leave_type lt ON lt.leave_type_id = l.leave_type_id
     LEFT JOIN tbl_cutoff_period cp ON cp.cutoff_id = l.cutoff_id
     WHERE l.employee_id = ?
     ORDER BY l.start_date DESC`,
    [employeeId]
  );
  return rows;
}

async function findByStatus(companyId, status, limit = 100) {
  const [rows] = await queryWithRetry(
    `SELECT l.leave_id, l.employee_id, l.leave_type_id, l.start_date, l.end_date,
            l.leave_days, l.reason, l.status, l.created_at,
            e.first_name, e.last_name, e.employee_number,
            lt.leave_type_name
     FROM tbl_leave l
     JOIN tbl_employees e ON e.employee_id = l.employee_id AND e.company_id = ?
     JOIN tbl_leave_type lt ON lt.leave_type_id = l.leave_type_id
     WHERE l.status = ?
     ORDER BY l.created_at DESC LIMIT ?`,
    [companyId, status, limit]
  );
  return rows;
}

async function getBalance(employeeId, leaveTypeId) {
  const [rows] = await queryWithRetry(
    `SELECT lb.balance_id, lb.total_credits, lb.used_credits, lb.carryover_credits,
            lb.remaining_credits, lb.year
     FROM tbl_leave_balance lb
     WHERE lb.employee_id = ? AND lb.leave_type_id = ? AND lb.year = YEAR(CURDATE())
     LIMIT 1`,
    [employeeId, leaveTypeId]
  );
  return rows[0] || null;
}

async function getAllBalances(employeeId, companyId) {
  const [rows] = await queryWithRetry(
    `SELECT lb.leave_type_id, lb.total_credits, lb.used_credits,
            lb.carryover_credits, lb.remaining_credits, lb.year,
            lt.leave_type_name, lt.is_paid
     FROM tbl_leave_balance lb
     JOIN tbl_leave_type lt ON lt.leave_type_id = lb.leave_type_id
     WHERE lb.employee_id = ? AND lb.year = YEAR(CURDATE())`,
    [employeeId]
  );
  return rows;
}

async function create(data, createdBy) {
  const [result] = await queryWithRetry(
    `INSERT INTO tbl_leave
       (employee_id, leave_type_id, cutoff_id, end_cutoff_id, start_date, end_date,
        leave_days, reason, status, form_upload_id, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NOW(), ?, NOW())`,
    [
      data.employee_id, data.leave_type_id, data.cutoff_id, data.end_cutoff_id ?? null,
      data.start_date, data.end_date, data.leave_days, data.reason ?? null,
      data.form_upload_id ?? null, createdBy, createdBy,
    ]
  );
  return result.insertId;
}

async function updateStatus(leaveId, status, updatedBy) {
  const [result] = await queryWithRetry(
    `UPDATE tbl_leave SET status = ?, updated_by = ?, updated_at = NOW() WHERE leave_id = ?`,
    [status, updatedBy, leaveId]
  );
  return result.affectedRows;
}

async function deductBalance(employeeId, leaveTypeId, days) {
  const [result] = await queryWithRetry(
    `UPDATE tbl_leave_balance
     SET used_credits = used_credits + ?, updated_at = NOW()
     WHERE employee_id = ? AND leave_type_id = ? AND year = YEAR(CURDATE())`,
    [days, employeeId, leaveTypeId]
  );
  return result.affectedRows;
}

module.exports = { findByEmployee, findByStatus, getBalance, getAllBalances, create, updateStatus, deductBalance };
