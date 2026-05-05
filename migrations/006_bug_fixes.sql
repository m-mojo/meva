-- ============================================================
-- MINERVA HRIS — Bug Fix & Audit Corrections
-- Version: 006 (applies on top of 005_lookup_seeds.sql)
-- Last updated: 2026-04-30
-- ============================================================
-- PURPOSE:
--   Correct schema and seed data errors discovered during code audit.
--   No structural redesign — all changes are targeted fixes.
--
-- SECTIONS:
--   1. tbl_import_column_map  — created_by nullable fix
--   2. tbl_raw_device_logs    — rename PK rdl_id → log_id
--   3. tbl_schedule           — remove 'regular' from sched_type + add leave_type_id FK
--   4. tbl_import_column_map  — add skip_col_letters column
--   5. tbl_punch_config       — add configurable punch_reset_hours
--   6. tbl_leave_type         — add is_paid flag + seed missing leave types
--   7. Import profile seed    — correct sentinel values and validation rules
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- SECTION 1: tbl_import_column_map — CREATED_BY NULLABLE
-- ============================================================
-- created_by was INT NOT NULL. System-seeded import profiles have no user
-- context at migration time, so the INSERTs in 004 and 005 used NULL.
-- Fix: make the column nullable so seed data is accepted correctly.
ALTER TABLE tbl_import_column_map
  MODIFY COLUMN created_by INT NULL;


-- ============================================================
-- SECTION 2: tbl_raw_device_logs — RENAME PK rdl_id → log_id
-- ============================================================
-- All application code references tbl_raw_device_logs.log_id.
-- Schema uses rdl_id as the PK column name. Rename to match.
-- No FK from other tables points to this column — safe rename.
ALTER TABLE tbl_raw_device_logs
  CHANGE COLUMN rdl_id log_id INT NOT NULL AUTO_INCREMENT;


-- ============================================================
-- SECTION 3: tbl_schedule — SCHED_TYPE CLEANUP + LEAVE_TYPE_ID
-- ============================================================

-- [S3A] Remove 'regular' from sched_type ENUM.
-- Regular working days use sched_type = NULL per spec.
-- 'regular' was never a valid assignable status; coordinator UIs must not set it.
-- 002_patches.sql removed 'holiday'; 'regular' was overlooked in that pass.
UPDATE tbl_schedule SET sched_type = NULL WHERE sched_type = 'regular';
ALTER TABLE tbl_schedule
  MODIFY COLUMN sched_type
    ENUM('off','absent','on_leave','fvl','dod','regot','changeoff','absent_with_notice') NULL;

-- [S3B] Add leave_type_id — links an on_leave/absent cell to the specific leave type
-- (VL, SL, Emergency Leave, FVL, LWP). NULL until HR assigns the type.
-- leave_type_id is set only when sched_type = 'on_leave' or 'fvl' or 'absent' + LWP.
ALTER TABLE tbl_schedule
  ADD COLUMN leave_type_id INT NULL AFTER sched_type,
  ADD CONSTRAINT fk_sched_leave_type
    FOREIGN KEY (leave_type_id) REFERENCES tbl_leave_type(leave_type_id);


-- ============================================================
-- SECTION 4: tbl_import_column_map — SKIP_COL_LETTERS
-- ============================================================
-- JSON array of Excel column letters to skip before header matching.
-- Used when multiple columns share the same header string and cannot be
-- distinguished by name alone (e.g., cols G, H, I all labeled 'Full Name').
-- Engine skips these letters entirely — no mapping, no validation.
ALTER TABLE tbl_import_column_map
  ADD COLUMN skip_col_letters JSON NULL AFTER skip_columns;


-- ============================================================
-- SECTION 5: tbl_punch_config — CONFIGURABLE PUNCH RESET HOURS
-- ============================================================
-- direction.js had the 14-hour reset threshold (Rule 4) hardcoded.
-- Config must come from tbl_punch_config per company_id so HR can adjust.
-- Default 14.00 matches the original hardcoded value; no behavior change on upgrade.
ALTER TABLE tbl_punch_config
  ADD COLUMN punch_reset_hours DECIMAL(4,2) NOT NULL DEFAULT 14.00
  AFTER duplicate_punch_window_seconds;


-- ============================================================
-- SECTION 6: tbl_leave_type — IS_PAID FLAG + SEED ALL TYPES
-- ============================================================

-- [L6A] Add is_paid flag.
-- Timekeeping computation uses this to determine whether an absent day
-- results in a salary deduction (LWP: FALSE → deduct) or credit consumption
-- (VL/SL/Emergency/FVL: TRUE → no deduction, credits are consumed instead).
-- Default TRUE so existing leave types are treated as paid (safe default).
ALTER TABLE tbl_leave_type
  ADD COLUMN is_paid BOOLEAN NOT NULL DEFAULT TRUE AFTER leave_type;

-- [L6B] Seed all Minerva leave types.
-- INSERT IGNORE is safe on re-run — uq_leave_type prevents duplicates.
INSERT IGNORE INTO tbl_leave_type
  (leave_type, is_paid, is_statutory, is_cash_convertible, sss_reimbursable)
VALUES
  -- SIL (Art. 95, PH Labor Code): 5 days minimum, convertible if unused
  ('Vacation Leave',        TRUE,  TRUE,  TRUE,  FALSE),
  -- Company benefit; statutory SIL covers both VL+SL combined
  ('Sick Leave',            TRUE,  FALSE, FALSE, FALSE),
  -- Company discretionary; unplanned personal emergency
  ('Emergency Leave',       TRUE,  FALSE, FALSE, FALSE),
  -- Company-initiated forced leave; employee still paid
  ('Forced Vacation Leave', TRUE,  FALSE, FALSE, FALSE),
  -- No credits remaining; full-day salary deducted from payroll
  ('Leave Without Pay',     FALSE, FALSE, FALSE, FALSE);


-- ============================================================
-- SECTION 7: IMPORT PROFILE SEED CORRECTIONS
-- ============================================================
-- Fixes errors introduced in 004_import_map_patches.sql and propagated
-- to the SSH clone in 005_lookup_seeds.sql.
--
-- field_training_end:
--   NULL → '@R'  (positional sentinel; col R has no header in the masterlist)
--
-- field_position_1_start:
--   'Coverage Date' → '@AA'  (positional sentinel; ambiguous duplicate header)
--
-- field_position_2_start:
--   'Coverage Date' → '@AC'  (positional sentinel; same duplicate header)
--
-- skip_col_letters:
--   ['G','H','I'] — three columns all labeled 'Full Name'; skip by letter not name
--
-- skip_columns:
--   Remove the three 'Full Name' entries (now handled by skip_col_letters above).
--   Keep: 'Date Today', 'Year', 'Month', 'Day', 'Age' — all have unique headers.
--
-- validation_rules:
--   Fix validate_only[0].source_field = 'field_probationary_end_col' (nonexistent)
--   → source_col = 'T'  (direct column letter reference — col T in the masterlist)
--
-- Applies to both UTH and SSH profiles (SSH is a structural clone of UTH).

UPDATE tbl_import_column_map
SET
  field_training_end     = '@R',
  field_position_1_start = '@AA',
  field_position_2_start = '@AC',
  skip_col_letters = JSON_ARRAY('G', 'H', 'I'),
  skip_columns = JSON_ARRAY(
    'Date Today',
    'Year',
    'Month',
    'Day',
    'Age'
  ),
  validation_rules = JSON_OBJECT(
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
        'source_col',  'T',
        'rule',        'abs_days(value, date_hired_plus_180) <= 5',
        'severity',    'warning',
        'message',     'Probationary end date deviates from expected date_hired + 180 days by more than 5 days. Verify source data.'
      ),
      JSON_OBJECT(
        'source_field', 'field_monthly_gross',
        'rule',         'abs(value - (basic_salary + allowance)) <= 1.00',
        'severity',     'warning',
        'message',      'Monthly Gross Pay mismatch: file value does not equal Basic Salary + Allowance.'
      )
    ),
    'back_calculate', JSON_ARRAY(
      JSON_OBJECT(
        'source_field',             'field_daily_rate',
        'target_field',             'basic_salary',
        'formula',                  'daily_rate * pay_factor',
        'condition',                'basic_salary IS NULL',
        'side_effect',              JSON_OBJECT('pay_class', 'Daily-paid'),
        'validation_tolerance_pct', 5
      )
    )
  )
WHERE profile_name IN (
  'Client Masterlist — UTH (v4)',
  'Client Masterlist — SSH (v4)'
);


-- ============================================================
-- SECTION 8: tbl_timekeeping / tbl_deduction / tbl_additional — COLUMN ALIGNMENT
-- ============================================================
-- Application code was written expecting these columns to exist but they were
-- never added to the base schema or earlier patches. All additions are additive;
-- no existing rows are affected.

-- [TK8] Add computed OT/ND columns to tbl_timekeeping.
--   ot_hours / nd_hours: raw computed hours (complements tbl_additional breakdowns)
--   has_break: snapshot of the shift's break flag at computation time
--   processed_at: timestamp of last successful computation run
ALTER TABLE tbl_timekeeping
  ADD COLUMN ot_hours     DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER total_hours_day,
  ADD COLUMN nd_hours     DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER ot_hours,
  ADD COLUMN has_break    BOOLEAN NOT NULL DEFAULT FALSE AFTER is_absent,
  ADD COLUMN processed_at TIMESTAMP NULL AFTER last_computed_at;

-- [D3] Add break_deduct_hours to tbl_deduction.
--   Break deduction is applied at computation time; the amount needs to be stored
--   per timekeeping row so the report engine doesn't recompute it.
ALTER TABLE tbl_deduction
  ADD COLUMN break_deduct_hours DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER halfday_hours;

-- [A3] Rename tbl_additional columns to match code expectations.
--   early_ot_hours → ot_hours   (combined OT; early/late split is unused by computation engine)
--   night_diff_hours → nd_hours (simple rename for consistency)
--   late_ot_hours dropped: OT is accumulated into ot_hours as a single value at MVP.
ALTER TABLE tbl_additional
  CHANGE COLUMN early_ot_hours  ot_hours  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  CHANGE COLUMN night_diff_hours nd_hours DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  DROP COLUMN late_ot_hours;


SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================
-- SECTION 9: tbl_user_account — COLUMN NAME ALIGNMENT
-- ============================================================
-- Base schema used `email` and `password` as column names.
-- Application code (db/queries/auth.js, services/auth.js, middleware/auth.js)
-- was written expecting `username`, `password_hash`, and `company_id`.
-- None of these were added in prior patches — every login attempt would fail.
--
-- Additionally, tbl_user_account.employee_id exists in the schema but is never
-- propagated to the JWT payload, so employee-scoped endpoints (getMyLeaves etc.)
-- cannot resolve the correct employee from ctx.user_id alone.
--
-- [UA9A] Rename `email` → `username` and `password` → `password_hash`.
--   CHANGE COLUMN preserves the column position.
--   The unique key uq_email is dropped and re-created as uq_username.
ALTER TABLE tbl_user_account
  DROP KEY uq_email,
  CHANGE COLUMN email     username      VARCHAR(150) NOT NULL,
  CHANGE COLUMN password  password_hash VARCHAR(255) NOT NULL;

ALTER TABLE tbl_user_account
  ADD UNIQUE KEY uq_username (username);

-- [UA9B] Add company_id — required for multi-tenant auth scoping.
--   NULL allowed so the bootstrap account (no company) can be inserted.
--   FK to tbl_company added; set to NULL for cross-company super_admin accounts.
ALTER TABLE tbl_user_account
  ADD COLUMN company_id INT NULL AFTER password_hash,
  ADD CONSTRAINT fk_useracc_company
    FOREIGN KEY (company_id) REFERENCES tbl_company(company_id);

-- ============================================================
-- VERIFICATION QUERIES (run after applying this file)
-- ============================================================
-- -- [1] created_by nullable
-- SHOW COLUMNS FROM tbl_import_column_map LIKE 'created_by';
--
-- -- [2] rdl_id renamed to log_id
-- SHOW COLUMNS FROM tbl_raw_device_logs LIKE 'log_id';
--
-- -- [3] sched_type ENUM (no 'regular', no 'holiday') + leave_type_id FK
-- SHOW COLUMNS FROM tbl_schedule LIKE 'sched_type';
-- SHOW COLUMNS FROM tbl_schedule LIKE 'leave_type_id';
--
-- -- [4] skip_col_letters added
-- SHOW COLUMNS FROM tbl_import_column_map LIKE 'skip_col_letters';
--
-- -- [5] punch_reset_hours added at 14.00
-- SELECT company_id, punch_reset_hours FROM tbl_punch_config;
--
-- -- [6] is_paid added, all five leave types seeded
-- SELECT leave_type_id, leave_type, is_paid, is_statutory FROM tbl_leave_type;
--
-- -- [7] Profile corrections applied
-- SELECT profile_name,
--        field_training_end, field_position_1_start, field_position_2_start,
--        skip_col_letters,
--        JSON_LENGTH(skip_columns) AS skip_col_count
-- FROM tbl_import_column_map
-- WHERE profile_name LIKE 'Client Masterlist%';
-- ============================================================
