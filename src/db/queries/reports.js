const { queryWithRetry } = require('../../config/db');

async function getTimekeepingSummary(cutoffId, companyId, subdeptId = null) {
  const where = ['tk.cutoff_id = ?', 'e.company_id = ?'];
  const params = [cutoffId, companyId];

  if (subdeptId) {
    where.push('e.subdepartment_id = ?');
    params.push(subdeptId);
  }

  const [rows] = await queryWithRetry(
    `SELECT e.employee_id, e.employee_number,
            CONCAT(e.last_name, ', ', e.first_name) AS employee_name,
            ep.position_name, sd.subdepartment_name,
            SUM(CASE WHEN tk.classification_status = 'classified' THEN tk.total_hours_day ELSE 0 END) AS regular_hours,
            SUM(tk.ot_hours) AS ot_hours,
            SUM(tk.nd_hours) AS nd_hours,
            SUM(tk.late_minutes) / 60 AS late_hours,
            SUM(tk.undertime_minutes) / 60 AS undertime_hours,
            SUM(d.break_deduct_hours) AS break_deduct_hours,
            SUM(CASE WHEN tk.is_absent = TRUE THEN 1 ELSE 0 END) AS absent_days
     FROM tbl_timekeeping tk
     JOIN tbl_employees e ON e.employee_id = tk.employee_id
     LEFT JOIN tbl_employee_position epos
            ON epos.employee_id = tk.employee_id AND epos.is_primary = TRUE AND epos.is_active = TRUE
     LEFT JOIN tbl_position ep ON ep.position_id = epos.position_id
     LEFT JOIN tbl_subdepartment sd ON sd.subdepartment_id = e.subdepartment_id
     LEFT JOIN tbl_deduction d ON d.timekeeping_id = tk.timekeeping_id
     WHERE ${where.join(' AND ')}
     GROUP BY e.employee_id, e.employee_number, employee_name, ep.position_name, sd.subdepartment_name
     ORDER BY sd.subdepartment_name, e.last_name, e.first_name`,
    params
  );
  return rows;
}

async function getPayrollDataView(cutoffId, companyId, subdeptId = null) {
  const where = ['tk.cutoff_id = ?', 'e.company_id = ?'];
  const params = [cutoffId, companyId];

  if (subdeptId) {
    where.push('e.subdepartment_id = ?');
    params.push(subdeptId);
  }

  const [rows] = await queryWithRetry(
    `SELECT e.employee_id, e.employee_number,
            CONCAT(e.last_name, ', ', e.first_name) AS employee_name,
            e.basic_salary, e.pay_factor,
            ep.position_name, sd.subdepartment_name,
            SUM(tk.total_hours_day) AS total_hours,
            SUM(tk.ot_hours) AS ot_hours,
            SUM(tk.nd_hours) AS nd_hours,
            SUM(tk.late_minutes) / 60 AS late_hours,
            SUM(tk.undertime_minutes) / 60 AS undertime_hours,
            SUM(d.break_deduct_hours) AS break_deduct,
            SUM(ad.ot_hours) AS paid_ot_hours,
            SUM(ad.nd_hours) AS paid_nd_hours
     FROM tbl_timekeeping tk
     JOIN tbl_employees e ON e.employee_id = tk.employee_id
     LEFT JOIN tbl_employee_position epos
            ON epos.employee_id = tk.employee_id AND epos.is_primary = TRUE AND epos.is_active = TRUE
     LEFT JOIN tbl_position ep ON ep.position_id = epos.position_id
     LEFT JOIN tbl_subdepartment sd ON sd.subdepartment_id = e.subdepartment_id
     LEFT JOIN tbl_deduction d ON d.timekeeping_id = tk.timekeeping_id
     LEFT JOIN tbl_additional ad ON ad.timekeeping_id = tk.timekeeping_id
     WHERE ${where.join(' AND ')}
     GROUP BY e.employee_id, e.employee_number, employee_name, e.basic_salary, e.pay_factor,
              ep.position_name, sd.subdepartment_name
     ORDER BY sd.subdepartment_name, e.last_name, e.first_name`,
    params
  );
  return rows;
}

async function logExport({ cutoffId, companyId, exportedBy, exportFormat, rowCount, fileName }) {
  const [result] = await queryWithRetry(
    `INSERT INTO tbl_payroll_export_log
       (cutoff_id, company_id, export_format, exported_by, exported_at, row_count, file_name)
     VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
    [cutoffId, companyId, exportFormat, exportedBy, rowCount, fileName ?? null]
  );
  return result.insertId;
}

module.exports = { getTimekeepingSummary, getPayrollDataView, logExport };
