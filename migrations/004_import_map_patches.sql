-- ============================================================
-- MINERVA HRIS — Import Column Map Patches
-- Version: 004 (applies on top of 003_seed_and_finalize.sql)
-- Last updated: 2026-04-28
-- ============================================================
-- PURPOSE:
--   Close all gaps discovered during masterlist gap analysis session.
--   Covers tbl_import_column_map additions and tbl_import_batch creation.
--
-- GAPS ADDRESSED:
--   Gap 1  — field_employee_status added (Employment Status column resolves to both
--             employment_type_id + employee_status_id; engine resolves dual lookup)
--   Gap 2  — field_training_end added (col R — unlabeled training end sub-column)
--   Gap 3  — Col T (probationary end) documented as validate-only via validation_rules
--   Gap 4  — Excel serial date conversion documented via validation_rules date_fields
--   Gap 5  — Position history fields added (1st/2nd position + coverage dates)
--   Gap 6  — field_previous_salary added
--   Gap 7  — field_monthly_gross added (validate-only; AG = AE + AF cross-check)
--   Gap 8  — field_daily_rate added (back-calculate or validate against basic_salary)
--   Gap 9  — Separation fields added (date_separated, separation_type, separation_reason)
--   Gap 10 — Structural config added (header_row, data_start_row, target_sheet)
--   Bonus  — tbl_import_batch created; FK wired on tbl_employees.import_batch_id
--
-- IMPORT ENGINE IMPLEMENTATION NOTES (read before building the service):
--
--   [Col T — Probationary End — validate_only]
--     Never store this value. If the column is mapped in validation_rules, the engine:
--       1. Parses the value as a date (including Excel serial conversion if needed).
--       2. Computes expected end = date_hired + 180 days.
--       3. If |parsed - expected| > 5 days → adds warning to import_batch row_warnings.
--     Store the rule in validation_rules JSON as shown in the seed profile below.
--
--   [Excel Serial Date Detection]
--     All columns tagged as "type": "date" in validation_rules.date_fields are subject to:
--       - If the raw cell value is numeric AND in range [25000, 60000]:
--           converted_date = new Date((serial - 25569) * 86400 * 1000)
--           If serial > 60: no adjustment (Lotus 1-2-3 leap year bug does not apply
--           to dates post-1900 in modern Excel with the Windows epoch).
--       - Otherwise parse as ISO date string or Philippine date format.
--     Engine MUST log every serial-to-date conversion in the batch warning log.
--
--   [Monthly Gross Pay — field_monthly_gross — validate_only]
--     Never store this value. If mapped, the engine cross-checks:
--       |monthly_gross - (basic_salary + allowance)| <= 1.00
--     If mismatch > ₱1.00 → warning (not error). Import proceeds.
--     Purpose: catch source file formula corruption before data enters the DB.
--
--   [Daily Rate — field_daily_rate — back-calculate or validate]
--     Two modes depending on whether basic_salary was resolved for that row:
--       Mode A (basic_salary IS NULL after all field reads):
--         basic_salary = daily_rate × pay_factor (default 313 for monthly employees)
--         pay_class overridden to 'Daily-paid'
--         Log as auto-computed.
--       Mode B (basic_salary IS NOT NULL):
--         Cross-check: |daily_rate × pay_factor - basic_salary| / basic_salary <= 0.05
--         If > 5% discrepancy → warning. Never block.
--     Never store daily_rate as a separate column.
--
--   [Employment Status dual resolution — Gap 1]
--     The masterlist has one "Employment Status" column that clients use for values
--     that belong to two separate DB lookups:
--       - employment_type_id: Regular, Probationary, Contractual, Project-based
--       - employee_status_id: Active, Resigned, Terminated, AWOL, Retired, Death, Separated
--     Engine resolution order for a single raw value (e.g., "Regular"):
--       1. Try to match against tbl_employment_type.type_name (case-insensitive).
--          If matched → set employment_type_id. employee_status_id defaults to 'Active'.
--       2. Try to match against tbl_employee_status.status_name (case-insensitive).
--          If matched → set employee_status_id. If value is terminal (Resigned,
--          Terminated, AWOL, Retired, Death, Separated) → set is_active = FALSE,
--          flag row for separation data completion.
--       3. If both field_employment_type AND field_employee_status are mapped to
--          different columns: resolve each independently. No dual-lookup needed.
--       4. If neither resolves → hard error on that row; row skipped.
--
--   [Inactive / 202 file detection]
--     On import, rows where employee_status_id resolves to a terminal status must:
--       a. Set is_active = FALSE.
--       b. Populate date_separated, separation_type, separation_reason
--          from field_date_separated, field_separation_type, field_separation_reason
--          IF those columns are present in the source file.
--       c. If separation data columns are absent or empty:
--          Set classification_status on the resulting employee record to a
--          'pending_202_completion' flag (see note on tbl_employees below).
--          HR Admin sees an "Incomplete 202" badge on those employee cards.
--       d. Do NOT block the import. Import the employee; flag for HR completion.
--
--   [Position history multi-insert]
--     Import engine processes position history AFTER the tbl_employees row is committed:
--       1. If field_position_1 resolves to a position_id → INSERT tbl_employee_position
--          (employee_id, position_id, is_primary=FALSE, position_start_date=field_position_1_start).
--       2. If field_position_2 resolves → INSERT second tbl_employee_position row.
--       3. The current position (field_position → tbl_employee_position is_primary=TRUE)
--          is always inserted last so its timestamp is newest.
--       4. Position name matching: case-insensitive against tbl_position.position_name
--          scoped to the resolved company_id. If no match → soft warning, skip that row.
--
--   [Multi-sheet import]
--     Use target_sheet to restrict reading to a specific worksheet. When target_sheet IS NULL,
--     the engine reads the first (active) sheet. For the separated employees use case:
--       - Profile A: target_sheet = 'UTH', header_row = 3, data_start_row = 4
--       - Profile B: target_sheet = 'SSH', header_row = 3, data_start_row = 4
--       - Profile C: target_sheet = '<Separated sheet name>', same structural config,
--         includes field_date_separated, field_separation_type, field_separation_reason mapped.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- SECTION 1: tbl_import_column_map — NEW FIELD MAPPINGS
-- ============================================================

-- [M1] Employment status mapping (Gap 1)
-- Sits after field_employment_type; engine tries to resolve against both lookup tables.
ALTER TABLE tbl_import_column_map
  ADD COLUMN field_employee_status VARCHAR(100) NULL AFTER field_employment_type;

-- [M2] Training end date (Gap 2) — col R in client masterlist
ALTER TABLE tbl_import_column_map
  ADD COLUMN field_training_end VARCHAR(100) NULL AFTER field_training_start;

-- [M3] Position history (Gap 5) — 1st and 2nd previous positions with start dates
ALTER TABLE tbl_import_column_map
  ADD COLUMN field_position_1       VARCHAR(100) NULL AFTER field_position,
  ADD COLUMN field_position_1_start VARCHAR(100) NULL AFTER field_position_1,
  ADD COLUMN field_position_2       VARCHAR(100) NULL AFTER field_position_1_start,
  ADD COLUMN field_position_2_start VARCHAR(100) NULL AFTER field_position_2;

-- [M4] Salary-adjacent fields (Gaps 6, 7, 8)
-- previous_salary: stored in DB
-- monthly_gross:   validate-only (AG = AE + AF cross-check); never stored
-- daily_rate:      back-calculate or validate; never stored as its own column
ALTER TABLE tbl_import_column_map
  ADD COLUMN field_previous_salary VARCHAR(100) NULL AFTER field_allowance,
  ADD COLUMN field_monthly_gross   VARCHAR(100) NULL AFTER field_previous_salary,
  ADD COLUMN field_daily_rate      VARCHAR(100) NULL AFTER field_monthly_gross;

-- [M5] Separation data (Gap 9) — may live in columns after BC or on a separate sheet
ALTER TABLE tbl_import_column_map
  ADD COLUMN field_date_separated    VARCHAR(100) NULL AFTER field_remarks,
  ADD COLUMN field_separation_type   VARCHAR(100) NULL AFTER field_date_separated,
  ADD COLUMN field_separation_reason VARCHAR(100) NULL AFTER field_separation_type;


-- ============================================================
-- SECTION 2: tbl_import_column_map — STRUCTURAL CONFIG (Gap 10)
-- ============================================================

-- Engine reads header at header_row, data starting at data_start_row.
-- Client masterlist uses header_row=3, data_start_row=4.
-- Generic profiles default to 1 and 2 respectively.
ALTER TABLE tbl_import_column_map
  ADD COLUMN header_row     TINYINT UNSIGNED NOT NULL DEFAULT 1  AFTER format_notes,
  ADD COLUMN data_start_row TINYINT UNSIGNED NOT NULL DEFAULT 2  AFTER header_row,
  ADD COLUMN target_sheet   VARCHAR(100)     NULL                AFTER data_start_row;


-- ============================================================
-- SECTION 3: tbl_import_column_map — ENGINE HINT COLUMNS
-- ============================================================

-- validation_rules: JSON config for derive-check and validate-only columns.
-- See implementation notes above for the expected schema.
-- Example:
--   {
--     "date_fields": ["field_date_hired", "field_training_start", "field_training_end",
--                     "field_probationary_start", "field_date_regularized",
--                     "field_date_of_birth", "field_date_separated",
--                     "field_position_1_start", "field_position_2_start"],
--     "validate_only": [
--       {
--         "source_field": "field_probationary_end_col",
--         "rule": "abs_days(value, date_hired + 180) <= 5",
--         "severity": "warning",
--         "message": "Probationary end date mismatch"
--       },
--       {
--         "source_field": "field_monthly_gross",
--         "rule": "abs(value - (basic_salary + allowance)) <= 1.00",
--         "severity": "warning",
--         "message": "Monthly Gross Pay mismatch"
--       }
--     ],
--     "back_calculate": [
--       {
--         "source_field": "field_daily_rate",
--         "target_field": "basic_salary",
--         "formula": "daily_rate * pay_factor",
--         "condition": "basic_salary IS NULL",
--         "side_effect": { "pay_class": "Daily-paid" },
--         "validation_tolerance_pct": 5
--       }
--     ]
--   }
ALTER TABLE tbl_import_column_map
  ADD COLUMN validation_rules JSON NULL AFTER target_sheet;

-- skip_columns: JSON array of Excel header strings to skip unconditionally.
-- Engine reads the header row, and if any header matches an entry in this list,
-- it skips that column entirely — no mapping, no validation, no warning.
-- Example: ["Full Name", "Date Today", "Year", "Month", "Day", "Age",
--           "Monthly Gross Pay", "Daily rate"]
-- Note: validate-only columns (col T, AG) go in validation_rules, not here —
-- they are read but not stored. skip_columns is for columns to ignore completely.
ALTER TABLE tbl_import_column_map
  ADD COLUMN skip_columns JSON NULL AFTER validation_rules;


-- ============================================================
-- SECTION 4: tbl_employees — 202 PENDING COMPLETION FLAG
-- ============================================================
-- When an inactive employee is imported but separation data is missing,
-- this flag drives the "Incomplete 202" HR review queue.
-- NULL = not imported or no issue. 'pending' = imported inactive, data missing.
-- 'complete' = HR has filled in all required 202 fields.
ALTER TABLE tbl_employees
  ADD COLUMN file_202_status ENUM('pending','complete') NULL AFTER is_active;


-- ============================================================
-- SECTION 5: tbl_import_batch — UPLOAD SESSION TRACKING
-- ============================================================
-- Tracks every upload event. import_batch_id on tbl_employees references this.
-- Enables rollback (soft-delete all employees where import_batch_id = X),
-- audit trail, and partial-success reporting.
CREATE TABLE tbl_import_batch (
  batch_id        VARCHAR(50)  NOT NULL,
  company_id      INT          NOT NULL,
  map_id          INT          NOT NULL,
  uploaded_by     INT          NOT NULL,
  source_file     VARCHAR(255) NOT NULL,
  target_sheet    VARCHAR(100) NULL,
  total_rows      INT          NOT NULL DEFAULT 0,
  success_rows    INT          NOT NULL DEFAULT 0,
  warning_rows    INT          NOT NULL DEFAULT 0,
  error_rows      INT          NOT NULL DEFAULT 0,
  status          ENUM('pending','processing','complete','partial','failed','rolled_back')
                  NOT NULL DEFAULT 'pending',
  started_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at    TIMESTAMP    NULL,
  rolled_back_at  TIMESTAMP    NULL,
  rolled_back_by  INT          NULL,
  notes           TEXT         NULL,
  PRIMARY KEY (batch_id),
  KEY idx_importbatch_company (company_id),
  KEY idx_importbatch_status  (status),
  CONSTRAINT fk_importbatch_company  FOREIGN KEY (company_id)    REFERENCES tbl_company(company_id),
  CONSTRAINT fk_importbatch_map      FOREIGN KEY (map_id)        REFERENCES tbl_import_column_map(map_id),
  CONSTRAINT fk_importbatch_user     FOREIGN KEY (uploaded_by)   REFERENCES tbl_user_account(user_acc_id),
  CONSTRAINT fk_importbatch_rollback FOREIGN KEY (rolled_back_by) REFERENCES tbl_user_account(user_acc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Wire the FK on tbl_employees.import_batch_id (column existed without FK in base DDL)
ALTER TABLE tbl_employees
  ADD CONSTRAINT fk_emp_import_batch
    FOREIGN KEY (import_batch_id) REFERENCES tbl_import_batch(batch_id);


-- ============================================================
-- SECTION 5.5: tbl_import_column_map — CREATED_BY NULLABLE
-- ============================================================
-- created_by was INT NOT NULL in 001_init.sql. System-seeded import profiles
-- have no user context at migration time. Must be relaxed before the seed below.
-- (Migration 006 repeats this ALTER for idempotency — harmless.)
ALTER TABLE tbl_import_column_map
  MODIFY COLUMN created_by INT NULL;


-- ============================================================
-- SECTION 6: SEED — DEFAULT IMPORT PROFILE FOR CLIENT MASTERLIST
-- ============================================================
-- Profile for the client's "Updated Masterlist" format (UTH sheet).
-- header_row=3 and data_start_row=4 match the actual file structure.
-- Validation rules pre-populated with known derived columns.
-- Column header strings match MASTERLIST_HEADERS.md exactly.
-- A second profile (target_sheet='SSH') can be cloned from this one.
-- Separation profile (target_sheet='<separated sheet name>') to be added
-- once the client confirms the sheet name and column layout.
-- NOTE: This INSERT uses company_id=NULL for a system-wide default profile.
-- To create a company-specific profile, clone and set company_id explicitly.

INSERT INTO tbl_import_column_map (
  company_id,
  profile_name,
  import_format,
  import_version,
  format_notes,
  header_row,
  data_start_row,
  target_sheet,
  field_last_name,
  field_first_name,
  field_middle_name,
  field_middle_initial,
  field_name_suffix,
  field_employee_number,
  field_company,
  field_department,
  field_subdepartment,
  field_position,
  field_position_1,
  field_position_1_start,
  field_position_2,
  field_position_2_start,
  field_employment_type,
  field_employee_status,
  field_date_hired,
  field_training_start,
  field_training_end,
  field_probationary_start,
  field_date_regularized,
  field_basic_salary,
  field_allowance,
  field_previous_salary,
  field_monthly_gross,
  field_daily_rate,
  field_payroll_type,
  field_payroll_account,
  field_gender,
  field_civil_status,
  field_date_of_birth,
  field_address,
  field_province,
  field_contact_number,
  field_email_address,
  field_education_attainment,
  field_education_course,
  field_sss,
  field_philhealth,
  field_pagibig,
  field_tin,
  field_dependent_count,
  field_emergency_contact_name,
  field_emergency_contact_rel,
  field_emergency_contact_phone,
  field_biometric_name,
  field_remarks,
  field_date_separated,
  field_separation_type,
  field_separation_reason,
  validation_rules,
  skip_columns,
  is_default,
  is_active,
  created_by
) VALUES (
  NULL,
  'Client Masterlist — UTH (v4)',
  'xlsx',
  '4',
  'Updated Masterlist sample (4).xlsx — UTH sheet. Headers in row 3, data from row 4. Columns B-BC confirmed. Separation data may exist in columns after BC (pending client confirmation).',
  3,    -- header_row
  4,    -- data_start_row
  'UTH',
  -- Name fields
  'Last Name',
  'First Name',
  'Middle Name',
  'Middle Initial',
  'Suffix',
  -- Org fields
  "Employee's ID No.",
  'Company',
  'Department',
  'Sub Department',
  'Position',
  -- Position history (cols Z-AC)
  '1st Position',
  'Coverage Date',        -- col AA: first coverage date (engine matches by column position, not name, since both coverage dates share the same header)
  '2nd Position',
  'Coverage Date',        -- col AC: second coverage date (same header — engine uses positional index after the 2nd Position column)
  -- Employment classification
  'Employment Status',    -- field_employment_type: "Regular", "Probationary", etc.
  'Employment Status',    -- field_employee_status: same column — engine resolves dual lookup
  -- Dates
  'Hired Date',
  'Training',             -- col Q: training start (merged header group)
  NULL,                   -- col R has no header — engine maps by column index after Training; set after confirming positional mapping
  'Probationary',         -- col S: probationary start (merged header group)
  'Regularization',
  -- Salary
  'Basic Salary',
  'Allowance',
  'Previous Salary',
  'Monthly Gross Pay',    -- validate-only: cross-checks col AE + AF
  'Daily rate',           -- back-calculate or validate
  'Type of payroll',
  'Payroll Account No.',
  -- Personal
  'Gender',
  'Civil Status',
  'Birthday',
  'Present Address',
  'Province',
  'Contact Number',
  'Email Address',
  'Education Attainment',
  'Course',
  -- Government IDs
  'SSS',
  'Philhealth',
  'PagIBIG No.',
  'TIN',
  'No. of Dependents',
  -- Emergency contact
  'Contact Person',
  'Relationship',
  'ER Contact No.',
  -- Biometric + misc
  NULL,                   -- field_biometric_name: not in this masterlist; enrolled separately via device
  'Remarks',
  -- Separation (confirm column names from client; NULL until confirmed)
  NULL,
  NULL,
  NULL,
  -- Validation rules (JSON)
  JSON_OBJECT(
    'date_fields', JSON_ARRAY(
      'field_date_hired',
      'field_training_start',
      'field_training_end',
      'field_probationary_start',
      'field_date_regularized',
      'field_date_of_birth',
      'field_date_separated',
      'field_position_1_start',
      'field_position_2_start'
    ),
    'validate_only', JSON_ARRAY(
      JSON_OBJECT(
        'source_field', 'field_probationary_end_col',
        'rule', 'abs_days(value, date_hired_plus_180) <= 5',
        'severity', 'warning',
        'message', 'Probationary end date in file deviates from expected date_hired + 180 days by more than 5 days. Verify source data.'
      ),
      JSON_OBJECT(
        'source_field', 'field_monthly_gross',
        'rule', 'abs(value - (basic_salary + allowance)) <= 1.00',
        'severity', 'warning',
        'message', 'Monthly Gross Pay mismatch: file value does not equal Basic Salary + Allowance.'
      )
    ),
    'back_calculate', JSON_ARRAY(
      JSON_OBJECT(
        'source_field', 'field_daily_rate',
        'target_field', 'basic_salary',
        'formula', 'daily_rate * pay_factor',
        'condition', 'basic_salary IS NULL',
        'side_effect', JSON_OBJECT('pay_class', 'Daily-paid'),
        'validation_tolerance_pct', 5
      )
    )
  ),
  -- skip_columns: Full Name variants, computed tenure columns, Age, and the positional
  -- probationary-end column (col T). Monthly Gross and Daily Rate are listed in
  -- validation_rules above and handled there — do NOT also list them here.
  JSON_ARRAY(
    'Full Name',         -- col G: Last, First MI.
    'Full Name',         -- col H: First MI. Last  (duplicate header — skip both)
    'Full Name',         -- col I: Last, First Middle
    'Date Today',        -- col U
    'Year',              -- col V: tenure year component
    'Month',             -- col W: tenure month component
    'Day',               -- col X: tenure day component
    'Age'                -- col AN: derived from date_of_birth
  ),
  TRUE,   -- is_default
  TRUE,   -- is_active
  NULL    -- created_by: NULL = system seed
);

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- VERIFICATION QUERIES (run after applying this file)
-- ============================================================
-- -- Confirm new columns exist:
-- DESCRIBE tbl_import_column_map;
--
-- -- Confirm seed profile loaded:
-- SELECT map_id, profile_name, header_row, data_start_row, target_sheet,
--        field_employee_status, field_training_end, field_previous_salary,
--        field_daily_rate, field_monthly_gross, field_position_1
-- FROM tbl_import_column_map WHERE is_default = TRUE;
--
-- -- Confirm tbl_import_batch created:
-- SHOW CREATE TABLE tbl_import_batch;
--
-- -- Confirm FK on tbl_employees:
-- SELECT CONSTRAINT_NAME, REFERENCED_TABLE_NAME
-- FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
-- WHERE TABLE_NAME = 'tbl_employees' AND COLUMN_NAME = 'import_batch_id';
--
-- -- Confirm file_202_status column added:
-- SHOW COLUMNS FROM tbl_employees LIKE 'file_202_status';
-- ============================================================

-- ============================================================
-- COVERAGE DATE COLUMN AMBIGUITY NOTE
-- ============================================================
-- Cols AA and AC are both labeled "Coverage Date" in the masterlist.
-- The import engine cannot distinguish them by header string alone.
-- Resolution strategy for the engine:
--   1. Scan all header cells in header_row left-to-right.
--   2. When a cell matches field_position_1 header ("1st Position"), record its column index.
--   3. The field_position_1_start column is the NEXT column after field_position_1's index.
--   4. Repeat for field_position_2 ("2nd Position") → field_position_2_start.
--   This positional approach is more robust than header string matching for duplicate headers.
-- If field_position_1 or field_position_2 headers are not found, skip position history import.
-- ============================================================
