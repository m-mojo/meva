const { queryWithRetry } = require('../../config/db');

async function findAll(companyId, { search, isActive = true, limit = 100, offset = 0 } = {}) {
  const where = ['e.company_id = ?', 'e.is_active = ?'];
  const params = [companyId, isActive];

  if (search) {
    where.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR e.employee_number LIKE ?)');
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const [rows] = await queryWithRetry(
    `SELECT e.employee_id, e.employee_number, e.first_name, e.middle_name, e.last_name,
            e.name_suffix, e.biometric_device_uid, e.biometric_name,
            e.date_hired, e.date_separated, e.is_active, e.pay_factor, e.basic_salary,
            e.employment_type_id, e.employee_status_id,
            ep.position_name, sd.subdepartment_name, d.department_name
     FROM tbl_employees e
     LEFT JOIN tbl_employee_position epos
            ON epos.employee_id = e.employee_id AND epos.is_primary = TRUE AND epos.is_active = TRUE
     LEFT JOIN tbl_position ep ON ep.position_id = epos.position_id
     LEFT JOIN tbl_subdepartment sd ON sd.subdepartment_id = e.subdepartment_id
     LEFT JOIN tbl_department d ON d.department_id = e.department_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.last_name, e.first_name
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return rows;
}

async function findById(employeeId, companyId) {
  const [rows] = await queryWithRetry(
    `SELECT e.*,
            ep.position_name, sd.subdepartment_name, d.department_name
     FROM tbl_employees e
     LEFT JOIN tbl_employee_position epos
            ON epos.employee_id = e.employee_id AND epos.is_primary = TRUE AND epos.is_active = TRUE
     LEFT JOIN tbl_position ep ON ep.position_id = epos.position_id
     LEFT JOIN tbl_subdepartment sd ON sd.subdepartment_id = e.subdepartment_id
     LEFT JOIN tbl_department d ON d.department_id = e.department_id
     WHERE e.employee_id = ? AND e.company_id = ?`,
    [employeeId, companyId]
  );
  return rows[0] || null;
}

async function findByBiometricUid(uid, companyId) {
  const [rows] = await queryWithRetry(
    `SELECT employee_id, biometric_device_uid, biometric_name, employee_number
     FROM tbl_employees
     WHERE biometric_device_uid = ? AND company_id = ? AND is_active = TRUE LIMIT 1`,
    [uid, companyId]
  );
  return rows[0] || null;
}

// utf8mb4_unicode_ci collation on the table makes this case-insensitive already
async function findByBiometricName(name, companyId) {
  const [rows] = await queryWithRetry(
    `SELECT employee_id, biometric_device_uid, biometric_name, employee_number
     FROM tbl_employees
     WHERE biometric_name = ? AND company_id = ? AND is_active = TRUE LIMIT 1`,
    [name, companyId]
  );
  return rows[0] || null;
}

async function findByEmployeeNumberSuffix(suffix, companyId) {
  const [rows] = await queryWithRetry(
    `SELECT employee_id, biometric_device_uid, biometric_name, employee_number
     FROM tbl_employees
     WHERE RIGHT(employee_number, 3) = ? AND company_id = ? AND is_active = TRUE LIMIT 1`,
    [suffix, companyId]
  );
  return rows[0] || null;
}

async function create(data, createdBy) {
  const [result] = await queryWithRetry(
    `INSERT INTO tbl_employees
       (company_id, employee_number, first_name, middle_name, middle_initial,
        last_name, name_suffix, department_id, subdepartment_id,
        employment_type_id, employee_status_id,
        date_hired, training_start_date, training_end_date,
        probationary_start_date, date_regularized,
        basic_salary, previous_salary, allowance, pay_factor,
        payroll_type, pay_class, payroll_account_number,
        gender, civil_status, date_of_birth, present_address, province,
        contact_number, email_address,
        education_attainment, education_course,
        sss_number, philhealth_number, pagibig_number, tin_number,
        dependent_count, biometric_device_uid, biometric_name,
        remarks, import_batch_id,
        is_active, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             TRUE, ?, NOW(), ?, NOW())`,
    [
      data.company_id,
      data.employee_number,
      data.first_name,
      data.middle_name          ?? null,
      data.middle_initial       ?? null,
      data.last_name,
      data.name_suffix          ?? null,
      data.department_id,
      data.subdepartment_id,
      data.employment_type_id,
      data.employee_status_id,
      data.date_hired,
      data.training_start_date  ?? null,
      data.training_end_date    ?? null,
      data.probationary_start_date ?? null,
      data.date_regularized     ?? null,
      data.basic_salary         ?? null,
      data.previous_salary      ?? null,
      data.allowance            ?? null,
      data.pay_factor           ?? 313,
      data.payroll_type         ?? null,
      data.pay_class            ?? null,
      data.payroll_account_number ?? null,
      data.gender               ?? null,
      data.civil_status         ?? null,
      data.date_of_birth        ?? null,
      data.present_address      ?? null,
      data.province             ?? null,
      data.contact_number       ?? null,
      data.email_address        ?? null,
      data.education_attainment ?? null,
      data.education_course     ?? null,
      data.sss_number           ?? null,
      data.philhealth_number    ?? null,
      data.pagibig_number       ?? null,
      data.tin_number           ?? null,
      data.dependent_count      ?? null,
      data.biometric_device_uid ?? null,
      data.biometric_name       ?? null,
      data.remarks              ?? null,
      data.import_batch_id      ?? null,
      createdBy,
      createdBy,
    ]
  );
  return result.insertId;
}

async function createEmergencyContact(employeeId, data, createdBy) {
  const [result] = await queryWithRetry(
    `INSERT INTO tbl_employee_emergency_contact
       (employee_id, contact_name, relationship, contact_number, is_primary,
        created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, FALSE, ?, NOW(), ?, NOW())`,
    [
      employeeId,
      data.contact_name    || '',
      data.relationship    ?? null,
      data.contact_number  ?? null,
      createdBy,
      createdBy,
    ]
  );
  return result.insertId;
}

async function createPosition(employeeId, data, createdBy) {
  const [result] = await queryWithRetry(
    `INSERT INTO tbl_employee_position
       (employee_id, position_id, is_primary, is_active, position_start_date,
        created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, TRUE, ?, ?, NOW(), ?, NOW())`,
    [
      employeeId,
      data.position_id,
      data.is_primary          ? true : false,
      data.position_start_date ?? null,
      createdBy,
      createdBy,
    ]
  );
  return result.insertId;
}

async function update(employeeId, companyId, data, updatedBy) {
  const fields = [];
  const params = [];

  const allowed = [
    'first_name', 'middle_name', 'middle_initial', 'last_name', 'name_suffix',
    'department_id', 'subdepartment_id', 'employment_type_id', 'employee_status_id',
    'date_hired', 'training_start_date', 'training_end_date',
    'probationary_start_date', 'date_regularized',
    'date_separated', 'separation_type', 'separation_reason', 'final_clearance',
    'basic_salary', 'previous_salary', 'allowance', 'pay_factor',
    'payroll_type', 'pay_class', 'payroll_account_number',
    'gender', 'civil_status', 'date_of_birth', 'present_address', 'province',
    'contact_number', 'email_address',
    'education_attainment', 'education_course',
    'sss_number', 'philhealth_number', 'pagibig_number', 'tin_number',
    'dependent_count', 'biometric_device_uid', 'biometric_name',
    'remarks', 'is_active',
  ];

  for (const key of allowed) {
    if (key in data) {
      fields.push(`${key} = ?`);
      params.push(data[key]);
    }
  }

  if (!fields.length) return 0;

  fields.push('updated_by = ?', 'updated_at = NOW()');
  params.push(updatedBy, employeeId, companyId);

  const [result] = await queryWithRetry(
    `UPDATE tbl_employees SET ${fields.join(', ')} WHERE employee_id = ? AND company_id = ?`,
    params
  );
  return result.affectedRows;
}

async function deactivate(employeeId, companyId, separationDate, separationType, separationReason, updatedBy) {
  const [result] = await queryWithRetry(
    `UPDATE tbl_employees
     SET is_active = FALSE, date_separated = ?,
         separation_type = ?, separation_reason = ?,
         updated_by = ?, updated_at = NOW()
     WHERE employee_id = ? AND company_id = ?`,
    [separationDate, separationType ?? null, separationReason ?? null, updatedBy, employeeId, companyId]
  );
  return result.affectedRows;
}

async function getImportProfile(companyId) {
  const [rows] = await queryWithRetry(
    `SELECT * FROM tbl_import_column_map WHERE company_id = ? AND is_active = TRUE LIMIT 1`,
    [companyId]
  );
  return rows[0] || null;
}

module.exports = {
  findAll, findById, findByBiometricUid, findByBiometricName,
  findByEmployeeNumberSuffix, create, createEmergencyContact, createPosition,
  update, deactivate, getImportProfile,
};
