const { queryWithRetry } = require('../../config/db');

async function findByStatus(companyId, status, formType = null, limit = 100) {
  const where = ['e.company_id = ?', 'fu.status = ?'];
  const params = [companyId, status];

  if (formType) {
    where.push('fu.form_type = ?');
    params.push(formType);
  }

  const [rows] = await queryWithRetry(
    `SELECT fu.form_upload_id, fu.employee_id, fu.form_type, fu.status,
            fu.is_hr_filed, fu.crosses_midnight,
            fu.cascade_notes, fu.timekeeping_id, fu.created_at,
            e.first_name, e.last_name, e.employee_number
     FROM tbl_form_upload fu
     JOIN tbl_employees e ON e.employee_id = fu.employee_id
     WHERE ${where.join(' AND ')}
     ORDER BY fu.created_at DESC LIMIT ?`,
    [...params, limit]
  );
  return rows;
}

async function findById(formUploadId, companyId) {
  const [rows] = await queryWithRetry(
    `SELECT fu.*, e.first_name, e.last_name, e.employee_number
     FROM tbl_form_upload fu
     JOIN tbl_employees e ON e.employee_id = fu.employee_id AND e.company_id = ?
     WHERE fu.form_upload_id = ?`,
    [companyId, formUploadId]
  );
  return rows[0] || null;
}

async function create(data, createdBy) {
  const [result] = await queryWithRetry(
    `INSERT INTO tbl_form_upload
       (employee_id, form_type, cutoff_id, status, is_hr_filed,
        crosses_midnight, timekeeping_id, cascade_notes, uploaded_by, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, NOW(), ?, NOW())`,
    [
      data.employee_id, data.form_type, data.cutoff_id ?? null,
      data.is_hr_filed ?? false, data.crosses_midnight ?? false,
      data.timekeeping_id ?? null, data.cascade_notes ?? null,
      createdBy, createdBy, createdBy,
    ]
  );
  return result.insertId;
}

async function approve(formUploadId, userId) {
  const [result] = await queryWithRetry(
    `UPDATE tbl_form_upload
     SET status = 'approved', approved_at = NOW(), reviewed_by = ?, updated_by = ?, updated_at = NOW()
     WHERE form_upload_id = ? AND status = 'pending'`,
    [userId, userId, formUploadId]
  );
  return result.affectedRows;
}

async function deny(formUploadId, userId) {
  const [result] = await queryWithRetry(
    `UPDATE tbl_form_upload
     SET status = 'denied', reviewed_by = ?, updated_by = ?, updated_at = NOW()
     WHERE form_upload_id = ?`,
    [userId, userId, formUploadId]
  );
  return result.affectedRows;
}

module.exports = { findByStatus, findById, create, approve, deny };
