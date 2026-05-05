'use strict';

const { pool, queryWithRetry } = require('../config/db');
const ExcelJS = require('exceljs');
const empQ = require('../db/queries/employees');

// Separation type raw string → DB ENUM value (case-insensitive lookup key)
const SEPARATION_TYPE_MAP = {
  'resigned':                        'resigned',
  'resignation':                     'resigned',
  'end of contract':                 'end_of_contract',
  'end-of-contract':                 'end_of_contract',
  'eoc':                             'end_of_contract',
  'terminated just cause':           'terminated_just_cause',
  'terminated - just cause':         'terminated_just_cause',
  'terminated (just cause)':         'terminated_just_cause',
  'terminated authorized cause':     'terminated_authorized_cause',
  'terminated - authorized cause':   'terminated_authorized_cause',
  'terminated (authorized cause)':   'terminated_authorized_cause',
  'awol':                            'awol',
  'retired':                         'retirement',
  'retirement':                      'retirement',
  'deceased':                        'death',
  'death':                           'death',
};

// Terminal employee statuses that set is_active = FALSE on import
const TERMINAL_STATUSES = new Set(['Resigned', 'Terminated', 'AWOL', 'Retired', 'Separated', 'Death']);

// -----------------------------------------------------------------------
// FIELD_TO_DB: maps field_* names to their handling category
//
//   direct        — raw value stored directly in tbl_employees column
//   fk            — resolve name string → integer ID via lookup
//   fk_dual       — same raw column resolves to employment_type OR employee_status
//   separation_type — ENUM normalization before store
//   child         — insert into child table after employee row created
//   validate      — read for cross-check only; never stored
// -----------------------------------------------------------------------
const FIELD_TO_DB = {
  // DIRECT
  field_last_name:            { type: 'direct', col: 'last_name' },
  field_first_name:           { type: 'direct', col: 'first_name' },
  field_middle_name:          { type: 'direct', col: 'middle_name' },
  field_middle_initial:       { type: 'direct', col: 'middle_initial' },
  field_name_suffix:          { type: 'direct', col: 'name_suffix' },
  field_employee_number:      { type: 'direct', col: 'employee_number' },
  field_date_hired:           { type: 'direct', col: 'date_hired' },
  field_training_start:       { type: 'direct', col: 'training_start_date' },
  field_training_end:         { type: 'direct', col: 'training_end_date' },
  field_probationary_start:   { type: 'direct', col: 'probationary_start_date' },
  field_date_regularized:     { type: 'direct', col: 'date_regularized' },
  field_date_separated:       { type: 'direct', col: 'date_separated' },
  field_separation_reason:    { type: 'direct', col: 'separation_reason' },
  field_basic_salary:         { type: 'direct', col: 'basic_salary' },
  field_allowance:            { type: 'direct', col: 'allowance' },
  field_previous_salary:      { type: 'direct', col: 'previous_salary' },
  field_payroll_type:         { type: 'direct', col: 'payroll_type' },
  field_payroll_account:      { type: 'direct', col: 'payroll_account_number' },
  field_gender:               { type: 'direct', col: 'gender' },
  field_civil_status:         { type: 'direct', col: 'civil_status' },
  field_date_of_birth:        { type: 'direct', col: 'date_of_birth' },
  field_address:              { type: 'direct', col: 'present_address' },
  field_province:             { type: 'direct', col: 'province' },
  field_contact_number:       { type: 'direct', col: 'contact_number' },
  field_email_address:        { type: 'direct', col: 'email_address' },
  field_education_attainment: { type: 'direct', col: 'education_attainment' },
  field_education_course:     { type: 'direct', col: 'education_course' },
  field_sss:                  { type: 'direct', col: 'sss_number' },
  field_philhealth:           { type: 'direct', col: 'philhealth_number' },
  field_pagibig:              { type: 'direct', col: 'pagibig_number' },
  field_tin:                  { type: 'direct', col: 'tin_number' },
  field_dependent_count:      { type: 'direct', col: 'dependent_count' },
  field_biometric_name:       { type: 'direct', col: 'biometric_name' },
  field_remarks:              { type: 'direct', col: 'remarks' },

  // FK — resolve name string → integer ID
  field_department:           { type: 'fk', col: 'department_id' },
  field_subdepartment:        { type: 'fk', col: 'subdepartment_id' },

  // DUAL LOOKUP — same raw value resolves to employment_type AND/OR employee_status
  field_employment_type:      { type: 'fk_dual' },
  field_employee_status:      { type: 'fk_dual' },

  // ENUM normalization
  field_separation_type:      { type: 'separation_type', col: 'separation_type' },

  // CHILD — inserted into a child table after tbl_employees row is committed
  field_position:             { type: 'child', childKey: 'primary_position' },
  field_position_1:           { type: 'child', childKey: 'position_1' },
  field_position_1_start:     { type: 'child', childKey: 'position_1_start' },
  field_position_2:           { type: 'child', childKey: 'position_2' },
  field_position_2_start:     { type: 'child', childKey: 'position_2_start' },
  field_emergency_contact_name:  { type: 'child', childKey: 'contact_name' },
  field_emergency_contact_rel:   { type: 'child', childKey: 'contact_rel' },
  field_emergency_contact_phone: { type: 'child', childKey: 'contact_phone' },

  // VALIDATE — read but never stored (cross-check at parse layer)
  field_company:              { type: 'validate' },
  field_monthly_gross:        { type: 'validate' },
  field_daily_rate:           { type: 'validate' },
};

// -----------------------------------------------------------------------

async function list(params, ctx) {
  return empQ.findAll(ctx.company_id, params);
}

async function get(employeeId, ctx) {
  const emp = await empQ.findById(employeeId, ctx.company_id);
  if (!emp) throw Object.assign(new Error('Employee not found'), { status: 404 });
  return emp;
}

async function create(data, ctx) {
  data.company_id = ctx.company_id;

  const required = [
    'employee_number', 'first_name', 'last_name', 'date_hired',
    'department_id', 'subdepartment_id', 'employment_type_id', 'employee_status_id',
  ];
  const missing = required.filter(f => data[f] == null || data[f] === '');
  if (missing.length) {
    throw Object.assign(new Error(`Required fields missing: ${missing.join(', ')}`), { status: 400 });
  }

  if (data.is_active === false || data.is_active === 0) {
    if (!data.date_separated && !data.separation_type) {
      data.file_202_status = 'pending';
    }
  }

  const employeeId = await empQ.create(data, ctx.user_id);
  return { employee_id: employeeId };
}

async function update(employeeId, data, ctx) {
  const n = await empQ.update(employeeId, ctx.company_id, data, ctx.user_id);
  if (!n) throw Object.assign(new Error('Employee not found or no changes'), { status: 404 });
}

async function deactivate(employeeId, separationDate, separationType, separationReason, ctx) {
  if (!separationDate) throw Object.assign(new Error('separation_date is required'), { status: 400 });
  const n = await empQ.deactivate(
    employeeId, ctx.company_id,
    separationDate, separationType ?? null, separationReason ?? null,
    ctx.user_id
  );
  if (!n) throw Object.assign(new Error('Employee not found'), { status: 404 });
}

// -----------------------------------------------------------------------
// BULK IMPORT
//
// fieldMap: { field_last_name: 'Last Name', field_department: 'Department', ...
//             map_id: 1, source_file: 'masterlist.xlsx' }
// rows:     [{ 'Last Name': 'Dela Cruz', 'First Name': 'Juan', ... }]
// -----------------------------------------------------------------------
async function bulkImport(rows, fieldMap, ctx) {
  const batchId = `BATCH-${ctx.company_id}-${Date.now()}`;

  await queryWithRetry(
    `INSERT INTO tbl_import_batch
       (batch_id, company_id, map_id, uploaded_by, source_file, total_rows, status)
     VALUES (?, ?, ?, ?, ?, ?, 'processing')`,
    [
      batchId, ctx.company_id,
      fieldMap.map_id      ?? null,
      ctx.user_id,
      fieldMap.source_file ?? 'json_import',
      rows.length,
    ]
  );

  const results = { batch_id: batchId, created: 0, skipped: 0, errors: [], warnings: [] };

  for (const [i, raw] of rows.entries()) {
    const rowNum = i + 2;
    try {
      const { empData, child, warnings } = await _resolveRow(raw, fieldMap, ctx.company_id);

      if (warnings.length) results.warnings.push({ row: rowNum, warnings });

      if (!empData.employee_number || !empData.last_name || !empData.first_name) {
        results.skipped++;
        continue;
      }

      const [existing] = await queryWithRetry(
        `SELECT employee_id FROM tbl_employees WHERE employee_number = ? AND company_id = ? LIMIT 1`,
        [empData.employee_number, ctx.company_id]
      );
      if (existing.length) {
        results.skipped++;
        continue;
      }

      empData.company_id      = ctx.company_id;
      empData.import_batch_id = batchId;

      if (!empData.is_active && !empData.date_separated && !empData.separation_type) {
        empData.file_202_status = 'pending';
      }

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const employeeId = await _insertEmployee(conn, empData, ctx.user_id);
        await _insertChildRecords(conn, employeeId, empData, child, ctx.user_id);
        await conn.commit();
        results.created++;
      } catch (txErr) {
        await conn.rollback();
        throw txErr;
      } finally {
        conn.release();
      }
    } catch (err) {
      results.errors.push({ row: rowNum, error: err.message });
    }
  }

  const status = results.errors.length === rows.length ? 'failed'
               : results.errors.length > 0             ? 'partial'
               : 'complete';

  await queryWithRetry(
    `UPDATE tbl_import_batch
     SET status = ?, success_rows = ?, error_rows = ?, warning_rows = ?, completed_at = NOW()
     WHERE batch_id = ?`,
    [status, results.created, results.errors.length, results.warnings.length, batchId]
  );

  return results;
}

// -----------------------------------------------------------------------
// INTERNALS
// -----------------------------------------------------------------------

async function _resolveRow(raw, fieldMap, companyId) {
  const empData  = {};
  const child    = {};
  const warnings = [];

  // DIRECT fields
  for (const [fieldKey, header] of Object.entries(fieldMap)) {
    if (!fieldKey.startsWith('field_')) continue;
    if (typeof header === 'string' && header.startsWith('@')) continue; // positional — handled at parse time

    const meta = FIELD_TO_DB[fieldKey];
    if (!meta || meta.type !== 'direct') continue;

    const rawVal = header ? (raw[header] ?? null) : null;
    empData[meta.col] = rawVal;
  }

  // CHILD fields (accumulate raw strings first; IDs resolved below)
  for (const [fieldKey, header] of Object.entries(fieldMap)) {
    if (!fieldKey.startsWith('field_')) continue;
    const meta = FIELD_TO_DB[fieldKey];
    if (!meta || meta.type !== 'child') continue;
    const rawVal = header && !String(header).startsWith('@') ? (raw[header] ?? null) : null;
    child[meta.childKey] = rawVal;
  }

  // FK: department (Pass 1)
  const deptHeader = fieldMap.field_department;
  if (deptHeader && raw[deptHeader]) {
    const [rows] = await queryWithRetry(
      `SELECT department_id FROM tbl_department WHERE department_name = ? AND company_id = ? LIMIT 1`,
      [raw[deptHeader], companyId]
    );
    if (rows.length) empData.department_id = rows[0].department_id;
    else warnings.push(`Department not found: "${raw[deptHeader]}"`);
  }

  // FK: subdepartment (Pass 2 — scoped to resolved department when available)
  const sdHeader = fieldMap.field_subdepartment;
  if (sdHeader && raw[sdHeader]) {
    const hasDept = Boolean(empData.department_id);
    const sql = hasDept
      ? `SELECT sd.subdepartment_id FROM tbl_subdepartment sd
         JOIN tbl_department d ON d.department_id = sd.department_id
         WHERE sd.subdepartment_name = ? AND d.company_id = ? AND sd.department_id = ? LIMIT 1`
      : `SELECT sd.subdepartment_id FROM tbl_subdepartment sd
         JOIN tbl_department d ON d.department_id = sd.department_id
         WHERE sd.subdepartment_name = ? AND d.company_id = ? LIMIT 1`;
    const params = hasDept
      ? [raw[sdHeader], companyId, empData.department_id]
      : [raw[sdHeader], companyId];
    const [rows] = await queryWithRetry(sql, params);
    if (rows.length) empData.subdepartment_id = rows[0].subdepartment_id;
    else warnings.push(`Subdepartment not found: "${raw[sdHeader]}"`);
  }

  // FK_DUAL: employment type + employee status (same raw column, two lookups)
  const dualHeader = fieldMap.field_employment_type || fieldMap.field_employee_status;
  const rawDual = dualHeader ? (raw[dualHeader] ?? null) : null;

  if (rawDual) {
    const [etRows] = await queryWithRetry(
      `SELECT employment_type_id FROM tbl_employment_type WHERE LOWER(employment_type) = LOWER(?) LIMIT 1`,
      [rawDual]
    );
    if (etRows.length) {
      empData.employment_type_id = etRows[0].employment_type_id;
      // Default employee_status to Active when only employment type resolved
      const [activeRow] = await queryWithRetry(
        `SELECT employee_status_id FROM tbl_employee_status WHERE employment_status = 'Active' LIMIT 1`, []
      );
      if (activeRow.length && !empData.employee_status_id) {
        empData.employee_status_id = activeRow[0].employee_status_id;
      }
    }

    const [esRows] = await queryWithRetry(
      `SELECT employee_status_id, employment_status FROM tbl_employee_status
       WHERE LOWER(employment_status) = LOWER(?) LIMIT 1`,
      [rawDual]
    );
    if (esRows.length) {
      empData.employee_status_id = esRows[0].employee_status_id;
      if (TERMINAL_STATUSES.has(esRows[0].employment_status)) {
        empData.is_active = false;
      }
    }

    if (!etRows.length && !esRows.length) {
      warnings.push(`Employment Status not resolved: "${rawDual}"`);
    }
  }

  // SEPARATION_TYPE normalization
  const sepHeader = fieldMap.field_separation_type;
  if (sepHeader && raw[sepHeader]) {
    const key = raw[sepHeader].toLowerCase().trim();
    const normalized = SEPARATION_TYPE_MAP[key];
    if (normalized) {
      empData.separation_type = normalized;
    } else {
      empData.separation_type = null;
      warnings.push(`Separation type not recognized: "${raw[sepHeader]}" — stored as null`);
    }
  }

  // CHILD: resolve position IDs
  if (child.primary_position) {
    child.primary_position_id = await _resolvePositionId(child.primary_position, companyId);
    if (!child.primary_position_id) warnings.push(`Position not found: "${child.primary_position}"`);
  }
  if (child.position_1) {
    child.position_1_id = await _resolvePositionId(child.position_1, companyId);
    if (!child.position_1_id) warnings.push(`Position 1 not found: "${child.position_1}"`);
  }
  if (child.position_2) {
    child.position_2_id = await _resolvePositionId(child.position_2, companyId);
    if (!child.position_2_id) warnings.push(`Position 2 not found: "${child.position_2}"`);
  }

  return { empData, child, warnings };
}

async function _resolvePositionId(positionName, companyId) {
  const [rows] = await queryWithRetry(
    `SELECT p.position_id FROM tbl_position p
     JOIN tbl_subdepartment sd ON sd.subdepartment_id = p.subdepartment_id
     JOIN tbl_department d ON d.department_id = sd.department_id
     WHERE LOWER(p.position_name) = LOWER(?) AND d.company_id = ? LIMIT 1`,
    [positionName, companyId]
  );
  return rows[0]?.position_id ?? null;
}

async function _insertEmployee(conn, d, userId) {
  const [result] = await conn.query(
    `INSERT INTO tbl_employees
       (company_id, employee_number, first_name, middle_name, middle_initial,
        last_name, name_suffix, department_id, subdepartment_id,
        employment_type_id, employee_status_id,
        date_hired, training_start_date, training_end_date,
        probationary_start_date, date_regularized,
        date_separated, separation_type, separation_reason,
        basic_salary, previous_salary, allowance, pay_factor,
        payroll_type, pay_class, payroll_account_number,
        gender, civil_status, date_of_birth, present_address, province,
        contact_number, email_address, education_attainment, education_course,
        sss_number, philhealth_number, pagibig_number, tin_number,
        dependent_count, biometric_device_uid, biometric_name, remarks,
        file_202_status, import_batch_id,
        is_active, created_by, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW())`,
    [
      d.company_id, d.employee_number, d.first_name,
      d.middle_name          ?? null, d.middle_initial        ?? null,
      d.last_name,           d.name_suffix          ?? null,
      d.department_id        ?? null, d.subdepartment_id      ?? null,
      d.employment_type_id   ?? null, d.employee_status_id    ?? null,
      d.date_hired,
      d.training_start_date  ?? null, d.training_end_date     ?? null,
      d.probationary_start_date ?? null, d.date_regularized   ?? null,
      d.date_separated       ?? null, d.separation_type       ?? null,
      d.separation_reason    ?? null,
      d.basic_salary         ?? null, d.previous_salary       ?? null,
      d.allowance            ?? null, d.pay_factor            ?? 313,
      d.payroll_type         ?? null, d.pay_class             ?? null,
      d.payroll_account_number ?? null,
      d.gender               ?? null, d.civil_status          ?? null,
      d.date_of_birth        ?? null, d.present_address       ?? null,
      d.province             ?? null, d.contact_number        ?? null,
      d.email_address        ?? null, d.education_attainment  ?? null,
      d.education_course     ?? null,
      d.sss_number           ?? null, d.philhealth_number     ?? null,
      d.pagibig_number       ?? null, d.tin_number            ?? null,
      d.dependent_count      ?? null, d.biometric_device_uid  ?? null,
      d.biometric_name       ?? null, d.remarks               ?? null,
      d.file_202_status      ?? null, d.import_batch_id,
      d.is_active !== false,          userId, userId,
    ]
  );
  return result.insertId;
}

async function _insertChildRecords(conn, employeeId, empData, child, userId) {
  if (child.contact_name) {
    await conn.query(
      `INSERT INTO tbl_employee_emergency_contact
         (employee_id, contact_name, relationship, contact_number, is_primary,
          created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, FALSE, ?, NOW(), ?, NOW())`,
      [employeeId, child.contact_name, child.contact_rel ?? null,
       child.contact_phone ?? null, userId, userId]
    );
  }

  // Position history: oldest positions first, primary current position last
  if (child.position_1_id) {
    await conn.query(
      `INSERT INTO tbl_employee_position
         (employee_id, position_id, is_primary, is_active, position_start_date,
          created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, FALSE, TRUE, ?, ?, NOW(), ?, NOW())`,
      [employeeId, child.position_1_id, child.position_1_start ?? null, userId, userId]
    );
  }
  if (child.position_2_id) {
    await conn.query(
      `INSERT INTO tbl_employee_position
         (employee_id, position_id, is_primary, is_active, position_start_date,
          created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, FALSE, TRUE, ?, ?, NOW(), ?, NOW())`,
      [employeeId, child.position_2_id, child.position_2_start ?? null, userId, userId]
    );
  }
  if (child.primary_position_id) {
    await conn.query(
      `INSERT INTO tbl_employee_position
         (employee_id, position_id, is_primary, is_active, position_start_date,
          created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, TRUE, TRUE, ?, ?, NOW(), ?, NOW())`,
      [employeeId, child.primary_position_id, empData.date_hired ?? null, userId, userId]
    );
  }
}

async function bulkImportFromFile(buffer, ctx) {
  const columnMap = await empQ.getImportProfile(ctx.company_id);
  if (!columnMap) throw Object.assign(new Error('No active import profile for this company'), { status: 400 });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = columnMap.sheet_name
    ? workbook.getWorksheet(columnMap.sheet_name)
    : workbook.worksheets[0];

  if (!worksheet) throw Object.assign(new Error('Worksheet not found in uploaded file'), { status: 400 });

  const startRow = columnMap.data_start_row || 2;
  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum >= startRow) rows.push(row.values.slice(1));
  });

  if (!rows.length) throw Object.assign(new Error('No data rows found in worksheet'), { status: 400 });

  return bulkImport(rows, columnMap, ctx);
}

module.exports = { list, get, create, update, deactivate, bulkImport, bulkImportFromFile };
