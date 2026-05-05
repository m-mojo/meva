const { queryWithRetry } = require('../../config/db');

async function findByUsername(username) {
  const [rows] = await queryWithRetry(
    `SELECT ua.user_acc_id, ua.employee_id, ua.username, ua.password_hash,
            ua.role, ua.company_id, ua.is_active, ua.is_bootstrap,
            GROUP_CONCAT(us.subdepartment_id) AS sub_dept_access_raw
     FROM tbl_user_account ua
     LEFT JOIN tbl_user_scope us ON us.user_acc_id = ua.user_acc_id
     WHERE ua.username = ?
     GROUP BY ua.user_acc_id`,
    [username]
  );
  return rows[0] || null;
}

async function findById(userId) {
  const [rows] = await queryWithRetry(
    `SELECT ua.user_acc_id, ua.employee_id, ua.username, ua.role,
            ua.company_id, ua.is_active,
            GROUP_CONCAT(us.subdepartment_id) AS sub_dept_access_raw
     FROM tbl_user_account ua
     LEFT JOIN tbl_user_scope us ON us.user_acc_id = ua.user_acc_id
     WHERE ua.user_acc_id = ?
     GROUP BY ua.user_acc_id`,
    [userId]
  );
  return rows[0] || null;
}

async function create({ username, passwordHash, role, companyId, employeeId = null, createdBy }) {
  const [result] = await queryWithRetry(
    `INSERT INTO tbl_user_account
       (employee_id, username, password_hash, role, company_id, is_active, is_bootstrap, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, TRUE, FALSE, ?, NOW())`,
    [employeeId, username, passwordHash, role, companyId, createdBy]
  );
  return result.insertId;
}

async function setScope(userId, subdeptIds) {
  await queryWithRetry(`DELETE FROM tbl_user_scope WHERE user_acc_id = ?`, [userId]);
  if (subdeptIds.length) {
    const values = subdeptIds.map(id => [userId, id]);
    await queryWithRetry(
      `INSERT INTO tbl_user_scope (user_acc_id, subdepartment_id) VALUES ?`,
      [values]
    );
  }
}

async function deactivate(userId, updatedBy) {
  const [result] = await queryWithRetry(
    `UPDATE tbl_user_account SET is_active = FALSE, updated_by = ?, updated_at = NOW()
     WHERE user_acc_id = ?`,
    [updatedBy, userId]
  );
  return result.affectedRows;
}

module.exports = { findByUsername, findById, create, setScope, deactivate };
