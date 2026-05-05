-- ============================================================
-- MINERVA HRIS — Lookup Seeds + Employment Lifecycle Patch
-- Version: 005 (applies on top of 004_import_map_patches.sql)
-- Last updated: 2026-04-28
-- ============================================================
-- PURPOSE:
--   1. Seed tbl_employment_type — Minerva vocabulary
--   2. Seed tbl_employee_status — Minerva vocabulary
--   3. Patch tbl_employee_employment_history — add promoted_by/promoted_at
--   4. Patch tbl_punch_config — add training_ending_reminder_days
--   5. Seed tbl_notification_config — training lifecycle triggers
--
-- EMPLOYMENT LIFECYCLE (confirmed by client 2026-04-28):
--   On Training (16 days) → Probationary (6 months) → Regular
--   Each transition requires HR Admin approval before the type changes.
--   The approval is a UI action (click "Promote" on employee profile).
--   No separate form required — approver identity recorded in history.
--
-- Julie note: Julie inserts its own vocabulary rows per client.
-- The engine always resolves against whatever is seeded — no code change needed.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- SECTION 0: tbl_notification_config — UNIQUE KEY DECISION
-- ============================================================
-- 002_patches.sql added company_id for future company-specific overrides,
-- but the original UNIQUE KEY (trigger_type) was not updated.
--
-- MINERVA RULING (confirmed 2026-04-28):
--   One HR Admin manages both UTH and SSH. Company-specific notification
--   routing is not needed — the same HR Admin receives all triggers
--   regardless of which company the employee belongs to.
--
-- DECISION: Keep the original UNIQUE KEY (trigger_type) as-is.
--   All configs seeded with company_id = NULL (system-wide).
--   Lookup in the notification service: WHERE trigger_type = ? only.
--   No fallback logic needed. No NULL-duplicate risk.
--
-- JULIE EXTENSION POINT (do not build now):
--   When Julie needs per-company routing, add a separate
--   tbl_notification_config_override table:
--     (company_id, trigger_type, notify_hr, delivery_hr, ...)
--     UNIQUE KEY (company_id, trigger_type)
--   The notification service checks the override first, falls back
--   to tbl_notification_config if no override exists.
--   This avoids polluting the base config table with NULL tricks
--   and keeps the Minerva lookup simple indefinitely.
--
-- NO DDL CHANGE NEEDED HERE.
-- The original uq_trigger_type key from 001_init.sql is correct for Minerva.


-- ============================================================
-- SECTION 1: tbl_employment_type — MINERVA VOCABULARY
-- ============================================================
-- These are the legal/contractual classifications of employment.
-- Ordered by lifecycle stage (1=earliest, 4=latest).
-- 'On Training' is NOT a legal PH category but the client uses it
-- internally for the first 16 days. Legally, the probationary clock
-- starts from day 1 (date_hired).
-- 'Project-based': hired for a specific project scope (Art. 295, PH Labor Code).
-- Employment ends when the project ends. Confirmed for inclusion by client.

INSERT IGNORE INTO tbl_employment_type (employment_type) VALUES
  ('On Training'),
  ('Probationary'),
  ('Regular'),
  ('Contractual'),
  ('Project-based');


-- ============================================================
-- SECTION 2: tbl_employee_status — MINERVA VOCABULARY
-- ============================================================
-- These are the current operational states of an employee.
-- An employee can be 'Probationary' as their type AND 'Active' as their status.
-- 'On Training' as a status mirrors the type for the first 16 days.
-- Terminal statuses (Resigned, Terminated, AWOL, Retired, Separated, Death)
-- all set is_active = FALSE during import or manual entry.
-- 'Death' is stored as a status for insurance/benefit processing clarity.

INSERT IGNORE INTO tbl_employee_status (employment_status) VALUES
  ('Active'),
  ('On Training'),
  ('On Leave'),
  ('Suspended'),
  ('AWOL'),
  ('Resigned'),
  ('Terminated'),
  ('Retired'),
  ('Separated'),
  ('Death');

-- NOTE: 'Probationary' as an employee_status is intentionally NOT seeded here.
-- 'Probationary' is an employment_type. The status of a probationary employee
-- is 'Active' — they are actively working. This keeps the dual-lookup clean:
-- col M = "Probationary" → matches tbl_employment_type only → status defaults to Active.
-- col M = "Resigned"     → matches tbl_employee_status only → is_active = FALSE.


-- ============================================================
-- SECTION 3: tbl_employee_employment_history — APPROVAL COLUMNS
-- ============================================================
-- recorded_by = who entered the change into the system (IT Admin / HR Admin)
-- promoted_by = who approved the promotion (HR Admin — the approver)
-- These may be the same person or different. Both are required for auditability.

ALTER TABLE tbl_employee_employment_history
  ADD COLUMN IF NOT EXISTS promoted_by INT NULL AFTER recorded_by,
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMP NULL AFTER promoted_by;

ALTER TABLE tbl_employee_employment_history
  DROP FOREIGN KEY IF EXISTS fk_emphistory_promoter;
ALTER TABLE tbl_employee_employment_history
  ADD CONSTRAINT fk_emphistory_promoter
    FOREIGN KEY (promoted_by) REFERENCES tbl_user_account(user_acc_id);


-- ============================================================
-- SECTION 4: tbl_punch_config — TRAINING ENDING REMINDER
-- ============================================================
-- Symmetric to probation_regularization_reminder_days.
-- N days before training_end_date, fire TRAINING_ENDING notification.
-- Default: 3 days before — gives HR 3 days to prepare the promotion action.
-- The background job that fires PROBATION_APPROACHING_REGULARIZATION
-- uses the same pattern; extend it to also check this value.

ALTER TABLE tbl_punch_config
  ADD COLUMN training_ending_reminder_days INT NOT NULL DEFAULT 3
  AFTER training_duration_days;

-- Seed the new column for existing company rows (if tbl_punch_config already populated)
UPDATE tbl_punch_config SET training_ending_reminder_days = 3
WHERE training_ending_reminder_days IS NULL OR training_ending_reminder_days = 0;


-- ============================================================
-- SECTION 5: tbl_notification_config — LIFECYCLE TRIGGERS
-- ============================================================
-- TRAINING_ENDING: HR Admin must approve promotion to Probationary.
--   Fires N days before training_end_date (per training_ending_reminder_days).
--   After notified, HR Admin goes to employee profile → clicks "Promote to Probationary".
--
-- EMPLOYMENT_TYPE_CHANGED: Fires after any promotion is committed.
--   Confirms to HR that the change was recorded.
--   Also notifies the Coordinator if the employee's schedule eligibility changes.

INSERT IGNORE INTO tbl_notification_config
  (trigger_type, priority_tier, is_enabled, notify_hr, notify_coordinator,
   delivery_hr, delivery_coordinator)
VALUES
  ('TRAINING_ENDING',        'high',   TRUE, TRUE, FALSE, 'in_app', NULL),
  ('EMPLOYMENT_TYPE_CHANGED','high',   TRUE, TRUE, TRUE,  'in_app', 'in_app');

-- PROBATION_APPROACHING_REGULARIZATION already seeded in base schema.
-- Verify it exists; insert if missing (safe via INSERT IGNORE).
INSERT IGNORE INTO tbl_notification_config
  (trigger_type, priority_tier, is_enabled, notify_hr, delivery_hr)
VALUES
  ('PROBATION_APPROACHING_REGULARIZATION', 'high', TRUE, TRUE, 'in_app');


SET FOREIGN_KEY_CHECKS = 1;


-- ============================================================
-- BACKGROUND JOB SPEC — Employment Lifecycle Checker
-- (For developer reference — runs nightly via PM2 cron or setInterval)
-- ============================================================
--
-- For each active employee (is_active = TRUE):
--
--   1. TRAINING_ENDING check:
--      IF training_end_date IS NOT NULL
--      AND employment_type = 'On Training'
--      AND DATEDIFF(training_end_date, CURDATE()) <= training_ending_reminder_days
--      AND no TRAINING_ENDING notification fired in the last 7 days for this employee:
--        → fire TRAINING_ENDING notification to HR Admin
--        → message: "{name}'s 16-day training period ends on {date}.
--                    Review and promote to Probationary if performance is satisfactory."
--
--   2. PROBATION_APPROACHING_REGULARIZATION check (existing):
--      IF employment_type = 'Probationary'
--      AND DATEDIFF(date_hired + 180 days, CURDATE()) <= probation_regularization_reminder_days
--      AND no notification fired in last 30 days for this employee:
--        → fire PROBATION_APPROACHING_REGULARIZATION
--        → message: "{name}'s 6-month probationary period ends on {date}.
--                    Review and promote to Regular if performance is satisfactory."
--
--   3. Auto-regularize check (if auto_regularize = TRUE):
--      IF employment_type = 'Probationary'
--      AND CURDATE() >= date_hired + 180 days
--      AND date_regularized IS NULL:
--        → UPDATE employment_type_id → Regular
--        → UPDATE date_regularized = CURDATE()
--        → INSERT tbl_employee_employment_history
--          (promoted_by = NULL means auto; notes = 'Auto-regularized by system')
--        → fire EMPLOYMENT_TYPE_CHANGED
--      If auto_regularize = FALSE: wait for HR Admin to click "Promote to Regular".
--
-- ============================================================
-- PROMOTION API SPEC — /api/employees/:id/promote
-- ============================================================
-- POST /api/employees/:id/promote
-- Body: { to: 'probationary' | 'regular', notes: string (optional) }
-- Auth: HR Admin only
--
-- Service logic:
--   1. Validate: current employment_type must be the predecessor of target
--      ('On Training' → 'probationary'; 'Probationary' → 'regular').
--      Reject any other combination with 400.
--   2. Resolve target employment_type_id from tbl_employment_type.
--   3. UPDATE tbl_employees:
--        employment_type_id = resolved_id
--        date_regularized   = CURDATE() (if promoting to regular)
--        probationary_start_date = CURDATE() (if promoting to probationary)
--        updated_by = req.user.user_id
--   4. INSERT tbl_employee_employment_history:
--        employee_id, employment_type_id (new), start_date = CURDATE(),
--        recorded_by = req.user.user_id, promoted_by = req.user.user_id,
--        promoted_at = NOW(), notes (optional)
--   5. Fire EMPLOYMENT_TYPE_CHANGED notification.
--   6. Fire audit log entry: EMPLOYEE_PROMOTED.
--   7. Return 200 { success: true, data: { new_type, promoted_at } }.
-- ============================================================


-- ============================================================
-- SECTION 6: SSH IMPORT PROFILE
-- ============================================================
-- Clone of the UTH profile with company_id=2 and target_sheet='SSH'.
-- All field mappings, validation rules, and skip columns are identical —
-- the SSH sheet is confirmed to share the same structure as UTH.
-- is_default = FALSE; the UTH profile (company_id=NULL) remains the default.
-- The unique key uq_import_profile_company(company_id, profile_name) is
-- satisfied because company_id=2 + this name has no existing row.

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
)
SELECT
  2,                                      -- company_id: SSH
  'Client Masterlist — SSH (v4)',
  import_format,
  import_version,
  'Updated Masterlist sample (4).xlsx — SSH sheet. Same structure as UTH profile. Cloned 2026-04-28.',
  header_row,
  data_start_row,
  'SSH',                                  -- target_sheet
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
  FALSE,                                  -- is_default: UTH profile is the default
  TRUE,
  NULL
FROM tbl_import_column_map
WHERE profile_name = 'Client Masterlist — UTH (v4)';


-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
-- SELECT employment_type_id, employment_type FROM tbl_employment_type;
-- SELECT employee_status_id, employment_status FROM tbl_employee_status;
-- SHOW COLUMNS FROM tbl_employee_employment_history LIKE 'promoted_%';
-- SHOW COLUMNS FROM tbl_punch_config LIKE 'training_ending%';
-- SELECT trigger_type, priority_tier, notify_hr FROM tbl_notification_config
--   WHERE trigger_type IN ('TRAINING_ENDING','EMPLOYMENT_TYPE_CHANGED',
--                          'PROBATION_APPROACHING_REGULARIZATION');
-- SELECT map_id, company_id, profile_name, target_sheet, is_default
--   FROM tbl_import_column_map ORDER BY company_id, map_id;
-- ============================================================
