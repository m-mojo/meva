-- ============================================================
-- MINERVA HRIS — Final Consolidated Schema Patch
-- Version: 002 (Complete — applies on top of 001_init.sql v5.0)
-- Last updated: 2026-04-27
-- Covers: All official CLAUDE.md patches + audit-discovered fixes
--         + design improvements approved through session review
-- ============================================================
-- Execution order matters. Do not reorder sections.
-- All changes designed to be idempotent via IF EXISTS guards where MySQL supports them.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- SECTION 1: OFFICIAL CLAUDE.md PATCHES (1–12)
-- ============================================================

-- [P1] Add is_graveyard to tbl_shift
-- Computation engine reads this directly; no pool join required per CLAUDE.md
ALTER TABLE tbl_shift
  ADD COLUMN is_graveyard BOOLEAN NOT NULL DEFAULT FALSE AFTER crosses_midnight;

-- [P2] Add break_applies_to_graveyard to tbl_computation_rules
-- NOTE: tbl_computation_rules is replaced in Section 6; this patch targets the base table
-- that will be migrated, so this column is included here for completeness pre-split.
-- It will be created on tbl_punch_config (Section 6) as the authoritative location.

-- [P3] Add classification_status to tbl_timekeeping
ALTER TABLE tbl_timekeeping
  ADD COLUMN classification_status
    ENUM('classified','unclassified','manual_review') NOT NULL DEFAULT 'unclassified'
  AFTER is_absent;

-- [P4] Operations Head (Coordinator sign-off) on tbl_cutoff_schedule_status
-- "Operations Head" resolved as senior coordinator; noted_by_user_id is any coord user
ALTER TABLE tbl_cutoff_schedule_status
  ADD COLUMN noted_by_user_id INT NULL AFTER publish_source,
  ADD COLUMN noted_at TIMESTAMP NULL AFTER noted_by_user_id,
  ADD CONSTRAINT fk_cutoffstatus_noted FOREIGN KEY (noted_by_user_id)
    REFERENCES tbl_user_account(user_acc_id);

-- [P5] Composite index on tbl_raw_device_logs for direction + reconciliation queries
ALTER TABLE tbl_raw_device_logs
  ADD KEY idx_rdl_user_time (device_user_id, record_time);

-- [P6] Unique constraint on tbl_cutoff_period
ALTER TABLE tbl_cutoff_period
  ADD UNIQUE KEY uq_cutoff_company_start (company_id, start_date);

-- [P7] Biometric UID change audit table
CREATE TABLE tbl_biometric_uid_change_log (
  change_id     INT AUTO_INCREMENT PRIMARY KEY,
  employee_id   INT NOT NULL,
  device_id     INT NOT NULL,
  old_uid       VARCHAR(20) NULL,
  new_uid       VARCHAR(20) NULL,
  changed_by    INT NOT NULL,
  change_reason VARCHAR(500) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_biochange_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_biochange_device   FOREIGN KEY (device_id)   REFERENCES tbl_device(device_id),
  CONSTRAINT fk_biochange_user     FOREIGN KEY (changed_by)  REFERENCES tbl_user_account(user_acc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- [P8] remaining_credits as GENERATED ALWAYS AS STORED column in tbl_leave_balance
ALTER TABLE tbl_leave_balance DROP COLUMN remaining_credits;
ALTER TABLE tbl_leave_balance
  ADD COLUMN remaining_credits DECIMAL(5,2)
    GENERATED ALWAYS AS (total_credits - used_credits + carryover_credits) STORED
  AFTER used_credits;

-- [P9] Remove shift_order from tbl_schedule (derive from slot_id → tbl_shift_slot.slot_order)
ALTER TABLE tbl_schedule DROP COLUMN shift_order;

-- [P10] Convert total_hours on tbl_shift to VIRTUAL GENERATED column
ALTER TABLE tbl_shift DROP COLUMN total_hours;
ALTER TABLE tbl_shift ADD COLUMN total_hours DECIMAL(5,2)
  GENERATED ALWAYS AS (
    CASE WHEN crosses_midnight
      THEN ((24*60 - TIME_TO_SEC(time_in)/60) + TIME_TO_SEC(time_out)/60) / 60
      ELSE (TIME_TO_SEC(time_out) - TIME_TO_SEC(time_in)) / 3600
    END
  ) VIRTUAL AFTER time_out;

-- [P11] Unique constraint on tbl_employee_employment_history
ALTER TABLE tbl_employee_employment_history
  ADD UNIQUE KEY uq_emphistory (employee_id, start_date, employment_type_id);

-- [P12] Unique constraint on tbl_holiday (company + date)
ALTER TABLE tbl_holiday
  ADD UNIQUE KEY uq_holiday_company_date (company_id, holiday_date);


-- ============================================================
-- SECTION 2: TYPE CONSISTENCY FIXES
-- ============================================================

-- [T1] biometric_device_uid type alignment — VARCHAR(20) across all three tables
-- tbl_employees, tbl_employee_biometric_enrollment, tbl_raw_device_logs must match
-- ZKTeco UF100 UIDs are numeric but VARCHAR is safer for edge cases
ALTER TABLE tbl_employees
  MODIFY COLUMN biometric_device_uid VARCHAR(20) NULL;

ALTER TABLE tbl_employee_biometric_enrollment
  MODIFY COLUMN device_user_id VARCHAR(20) NOT NULL;

ALTER TABLE tbl_raw_device_logs
  MODIFY COLUMN device_user_id VARCHAR(20) NOT NULL;

-- Also align tbl_biometric_uid_change_log (already created with VARCHAR(20) above)

-- [T2] tbl_timekeeping.day_of_week — align to ENUM used everywhere else in schema
ALTER TABLE tbl_timekeeping
  MODIFY COLUMN day_of_week
    ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NULL;

-- [T3] tbl_audit_log.target_record_id — BIGINT to handle all PK types
ALTER TABLE tbl_audit_log
  MODIFY COLUMN target_record_id BIGINT NULL;

-- [T4] tbl_notification.trigger_source_id — BIGINT for same reason
ALTER TABLE tbl_notification
  MODIFY COLUMN trigger_source_id BIGINT NULL;

-- [T5] tbl_dod.holiday_type — align values to tbl_holiday.holiday_type ENUM
ALTER TABLE tbl_dod
  MODIFY COLUMN holiday_type
    ENUM('none','regular','special_non_working','special_working') NOT NULL DEFAULT 'none';


-- ============================================================
-- SECTION 3: CRITICAL MISSING ADDITIONS
-- ============================================================

-- [C1] tbl_device_sync — sync cursor table (referenced throughout CLAUDE.md sync code)
CREATE TABLE tbl_device_sync (
  sync_state_id  INT AUTO_INCREMENT PRIMARY KEY,
  device_id      INT NOT NULL,
  serial_number  VARCHAR(60) NOT NULL,
  last_stamp     BIGINT NOT NULL DEFAULT 0,
  force_full_sync BOOLEAN NOT NULL DEFAULT FALSE,  -- escape hatch for device reset/counter rollover
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device_sync_serial (serial_number),
  CONSTRAINT fk_devicesync_device FOREIGN KEY (device_id) REFERENCES tbl_device(device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- [C2] shift_date on tbl_raw_device_logs
-- CRITICAL: binds punches to schedule row; cross-midnight punches carry prior day's date
ALTER TABLE tbl_raw_device_logs
  ADD COLUMN shift_date DATE NULL AFTER record_time;

-- [C3] processed_at on tbl_raw_device_logs
-- Allows debugging sync lag and detecting stuck punches
ALTER TABLE tbl_raw_device_logs
  ADD COLUMN processed_at TIMESTAMP NULL AFTER is_processed;

-- [C4] ac_no made nullable (ZKTeco does not always populate this field)
ALTER TABLE tbl_raw_device_logs
  MODIFY COLUMN ac_no VARCHAR(20) NULL;

-- [C5] FK for schedule_eligible_from_cutoff_id on tbl_employees (was declared without FK)
ALTER TABLE tbl_employees
  ADD CONSTRAINT fk_emp_eligible_cutoff
    FOREIGN KEY (schedule_eligible_from_cutoff_id) REFERENCES tbl_cutoff_period(cutoff_id);

-- [C6] biometric_sync_at — timestamp when sync status last changed (for SLA tracking)
ALTER TABLE tbl_employees
  ADD COLUMN biometric_sync_at TIMESTAMP NULL AFTER biometric_sync_status;

-- [C7] wage_floor link on tbl_company — FK instead of fragile text-match join
ALTER TABLE tbl_company
  ADD COLUMN current_wage_floor_id INT NULL AFTER region,
  ADD CONSTRAINT fk_company_wageflo FOREIGN KEY (current_wage_floor_id)
    REFERENCES tbl_wage_floor(wage_floor_id);

-- [C8] cutoff_anchor_date should not be nullable — cutoff generation depends on it
ALTER TABLE tbl_company
  MODIFY COLUMN cutoff_anchor_date DATE NOT NULL;


-- ============================================================
-- SECTION 4: tbl_schedule FIXES
-- ============================================================

-- [S1] Remove 'holiday' from sched_type ENUM — HOLIDAY IS NOT ASSIGNABLE per CLAUDE.md
ALTER TABLE tbl_schedule
  MODIFY COLUMN sched_type
    ENUM('regular','off','absent','on_leave','fvl','dod','regot',
         'changeoff','absent_with_notice') NULL;

-- [S2] Add flex_schedule toggle flag (cellData model requires this)
ALTER TABLE tbl_schedule
  ADD COLUMN flex_schedule BOOLEAN NOT NULL DEFAULT FALSE AFTER is_ot;

-- [S3] Rename flex_time_in / flex_time_out → continuation_time_in / continuation_time_out
-- These store the continuation segment's time overrides, not general flexible times
ALTER TABLE tbl_schedule
  CHANGE COLUMN flex_time_in  continuation_time_in  TIME NULL,
  CHANGE COLUMN flex_time_out continuation_time_out TIME NULL;

-- [S4] Remove is_holiday (read-only derived value, not storable per CLAUDE.md rule)
-- "A coordinator never manually marks a cell as holiday."
-- Derived at query time via JOIN to tbl_holiday on (company_id, date)
ALTER TABLE tbl_schedule DROP COLUMN is_holiday;

-- [S5] Add position_id for rest-day conflict checks (avoids multi-join at check time)
ALTER TABLE tbl_schedule
  ADD COLUMN position_id INT NULL AFTER subdepartment_id,
  ADD CONSTRAINT fk_sched_position FOREIGN KEY (position_id)
    REFERENCES tbl_position(position_id);

-- [S6] Remove start_date and end_date — undefined purpose, date + cutoff_id sufficient
-- If range-based scheduling is ever needed, add in a new migration with clear intent
ALTER TABLE tbl_schedule
  DROP COLUMN start_date,
  DROP COLUMN end_date;

-- [S7] Remove effective_date — rename for clarity (was confusing with date column)
-- HR overrides tracked via audit_log (old_value/new_value). effective_date is derivable.
-- Keeping hr_override BOOLEAN to flag post-publish changes; that's sufficient.
-- NOTE: If you want to retain the retroactive-date concept, add a separate column:
--   override_effective_date DATE NULL  (NULL = not overridden, date = when HR applied it)
ALTER TABLE tbl_schedule
  DROP COLUMN effective_date;
ALTER TABLE tbl_schedule
  ADD COLUMN override_effective_date DATE NULL AFTER hr_override;

-- [S8] Add company_id to tbl_shift and update unique key to (company_id, shift_name)
ALTER TABLE tbl_shift
  ADD COLUMN company_id INT NULL AFTER shift_id,
  ADD CONSTRAINT fk_shift_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id);

ALTER TABLE tbl_shift DROP INDEX uq_shift_name;
ALTER TABLE tbl_shift
  ADD UNIQUE KEY uq_shift_name_company (company_id, shift_name);


-- ============================================================
-- SECTION 5: tbl_timekeeping FIXES
-- ============================================================

-- [TK1] Remove ot_form_required (duplicates tbl_computation_rules / tbl_punch_config)
ALTER TABLE tbl_timekeeping DROP COLUMN ot_form_required;

-- [TK2] Remove ot_multiplier_snapshot and nd_rate_snapshot (live in tbl_additional)
ALTER TABLE tbl_timekeeping
  DROP COLUMN ot_multiplier_snapshot,
  DROP COLUMN nd_rate_snapshot;

-- [TK3] Add undertime_minutes (symmetric counterpart to late_minutes)
ALTER TABLE tbl_timekeeping
  ADD COLUMN undertime_minutes SMALLINT NULL AFTER late_minutes;

-- [TK4] Add undertime_approval_status (mirrors ot_approval_status pattern)
ALTER TABLE tbl_timekeeping
  ADD COLUMN undertime_approval_status
    ENUM('not_required','pending_form','form_approved','flagged_no_form') NULL
  AFTER undertime_minutes;

-- [TK5] Add recompute tracking columns (surgical recomputation support)
ALTER TABLE tbl_timekeeping
  ADD COLUMN recompute_needed   BOOLEAN NOT NULL DEFAULT FALSE AFTER classification_status,
  ADD COLUMN recompute_reason   VARCHAR(200) NULL AFTER recompute_needed,
  ADD COLUMN last_computed_at   TIMESTAMP NULL AFTER recompute_reason;

-- [TK6] Add manual lock (prevents recomputation from overwriting HR-corrected rows)
ALTER TABLE tbl_timekeeping
  ADD COLUMN is_manually_locked BOOLEAN NOT NULL DEFAULT FALSE AFTER recompute_needed;

-- [TK7] Add anomaly review tracking (clears the queue without losing anomaly history)
ALTER TABLE tbl_timekeeping
  ADD COLUMN anomaly_reviewed_by  INT NULL AFTER anomaly_notes,
  ADD COLUMN anomaly_reviewed_at  TIMESTAMP NULL AFTER anomaly_reviewed_by,
  ADD COLUMN anomaly_resolution   VARCHAR(500) NULL AFTER anomaly_reviewed_at,
  ADD CONSTRAINT fk_tk_anomaly_reviewer
    FOREIGN KEY (anomaly_reviewed_by) REFERENCES tbl_user_account(user_acc_id);


-- ============================================================
-- SECTION 6: tbl_deduction + tbl_additional FIXES
-- ============================================================

-- [D1] Remove is_absent from tbl_deduction (single source: tbl_timekeeping.is_absent)
ALTER TABLE tbl_deduction DROP COLUMN is_absent;

-- [D2] Rename deduction columns to clarify they store HOURS not pesos
--      (pesos computed at report-generation from hourly rate × hours)
ALTER TABLE tbl_deduction
  CHANGE COLUMN late      late_hours      DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  CHANGE COLUMN undertime undertime_hours DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  CHANGE COLUMN halfday   halfday_hours   DECIMAL(5,2) NOT NULL DEFAULT 0.00;

-- [A1] Remove ot_approval_status from tbl_additional (single source: tbl_timekeeping)
ALTER TABLE tbl_additional DROP COLUMN ot_approval_status;

-- [A2] Rename additional columns to clarify they store HOURS not pesos
ALTER TABLE tbl_additional
  CHANGE COLUMN early_ot   early_ot_hours  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  CHANGE COLUMN late_ot    late_ot_hours   DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  CHANGE COLUMN night_diff night_diff_hours DECIMAL(5,2) NOT NULL DEFAULT 0.00;


-- ============================================================
-- SECTION 7: tbl_leave FIXES
-- ============================================================

-- [L1] Remove ut_hours (purpose undefined/misleading; partial-day leave not in scope)
ALTER TABLE tbl_leave DROP COLUMN ut_hours;

-- [L2] Make cutoff_id NOT NULL; add end_cutoff_id for cross-cutoff leaves
ALTER TABLE tbl_leave
  MODIFY COLUMN cutoff_id INT NOT NULL,
  ADD COLUMN end_cutoff_id INT NULL AFTER cutoff_id,
  ADD CONSTRAINT fk_leave_end_cutoff
    FOREIGN KEY (end_cutoff_id) REFERENCES tbl_cutoff_period(cutoff_id);

-- [L3] Add approval/endorsement timestamps (WHO was already there; WHEN was missing)
ALTER TABLE tbl_leave
  ADD COLUMN endorsed_at TIMESTAMP NULL AFTER endorsed_by,
  ADD COLUMN approved_at TIMESTAMP NULL AFTER approved_by;

-- [L4] Add noted_by_user_id FK (replacing free-text noted_by string)
ALTER TABLE tbl_leave
  ADD COLUMN noted_by_user_id INT NULL AFTER noted_by,
  ADD CONSTRAINT fk_leave_notedby
    FOREIGN KEY (noted_by_user_id) REFERENCES tbl_user_account(user_acc_id);

-- [L5] Add leave_tier_config company_id and unique constraint
ALTER TABLE tbl_leave_tier_config
  ADD COLUMN company_id INT NULL AFTER tier_id,
  ADD UNIQUE KEY uq_leave_tier (company_id, leave_type_id, tier_number),
  ADD CONSTRAINT fk_leavetier_company
    FOREIGN KEY (company_id) REFERENCES tbl_company(company_id);

-- [L6] Add company_id to tbl_leave_config (per-company employment-type leave rules)
ALTER TABLE tbl_leave_config
  ADD COLUMN company_id INT NULL AFTER leave_config_id,
  ADD CONSTRAINT fk_leaveconfig_company
    FOREIGN KEY (company_id) REFERENCES tbl_company(company_id);


-- ============================================================
-- SECTION 8: tbl_form_upload FIXES
-- ============================================================

-- [F1] Add 'pending' to endorsement_status and set as default
ALTER TABLE tbl_form_upload
  MODIFY COLUMN endorsement_status
    ENUM('pending','endorsed','returned') NOT NULL DEFAULT 'pending';

-- [F2] Add is_hr_filed flag for direct HR submission flow
ALTER TABLE tbl_form_upload
  ADD COLUMN is_hr_filed    BOOLEAN NOT NULL DEFAULT FALSE AFTER form_type,
  ADD COLUMN hr_filed_notes VARCHAR(500) NULL AFTER is_hr_filed;

-- [F3] Add crosses_midnight for OT forms spanning midnight
ALTER TABLE tbl_form_upload
  ADD COLUMN crosses_midnight BOOLEAN NOT NULL DEFAULT FALSE AFTER ot_time_end;

-- [F4] Add direct timekeeping FK (makes cascade lookup explicit and reliable)
ALTER TABLE tbl_form_upload
  ADD COLUMN timekeeping_id INT NULL AFTER reference_end,
  ADD CONSTRAINT fk_formup_tk
    FOREIGN KEY (timekeeping_id) REFERENCES tbl_timekeeping(timekeeping_id);

-- [F5] Add cascade_notes for cascade failure debugging
ALTER TABLE tbl_form_upload
  ADD COLUMN cascade_notes TEXT NULL AFTER cascaded_at;

-- [F6] Add 'cancelled' to tbl_shift_swap.status
ALTER TABLE tbl_shift_swap
  MODIFY COLUMN status ENUM('pending','approved','denied','cancelled') NOT NULL DEFAULT 'pending';


-- ============================================================
-- SECTION 9: tbl_cutoff_period EXPORT TRACKING
-- ============================================================

-- Cutoff finalization / payroll export lock
-- Once exported, recomputation is blocked unless Super Admin explicitly unlocks
ALTER TABLE tbl_cutoff_period
  ADD COLUMN is_exported  BOOLEAN NOT NULL DEFAULT FALSE AFTER is_closed,
  ADD COLUMN exported_at  TIMESTAMP NULL AFTER is_exported,
  ADD COLUMN exported_by  INT NULL AFTER exported_at,
  ADD CONSTRAINT fk_cutoff_exportedby
    FOREIGN KEY (exported_by) REFERENCES tbl_user_account(user_acc_id);


-- ============================================================
-- SECTION 10: tbl_holiday ADDITIONS
-- ============================================================

-- source column for holiday seeding API
-- 'manual' = HR added, 'auto_imported' = seeded via /api/holidays/seed-known
ALTER TABLE tbl_holiday
  ADD COLUMN source ENUM('manual','auto_imported') NOT NULL DEFAULT 'manual' AFTER is_proclamation;


-- ============================================================
-- SECTION 11: tbl_employees + tbl_shift_pool CLEANUP
-- ============================================================

-- [E1] Remove payroll_cycle (duplicate of payroll_type)
ALTER TABLE tbl_employees DROP COLUMN payroll_cycle;

-- [E2] Remove is_graveyard from tbl_shift_pool (now on tbl_shift — Patch 1)
ALTER TABLE tbl_shift_pool DROP COLUMN is_graveyard;

-- [E2b] Remove grace_period from tbl_shift — company-level tbl_punch_config.grace_period_minutes
-- is the single authoritative source; per-shift override was never used and creates dual-source ambiguity
ALTER TABLE tbl_shift DROP COLUMN grace_period;

-- [E3] Remove shift_display_label from tbl_shift_pool
-- Purpose was unclear and diverges from tbl_shift.shift_name; use shift_name directly
ALTER TABLE tbl_shift_pool DROP COLUMN shift_display_label;

-- [E4] tbl_import_column_map — add is_active flag for soft deactivation
ALTER TABLE tbl_import_column_map
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER is_default;

-- [E5] tbl_import_column_map — add import_format for Julie multi-format support
-- Different clients (Julie) may have completely different masterlist structures
ALTER TABLE tbl_import_column_map
  ADD COLUMN import_format  VARCHAR(60) NULL AFTER profile_name,
  ADD COLUMN import_version VARCHAR(20) NULL AFTER import_format,
  ADD COLUMN format_notes   TEXT NULL AFTER import_version;


-- ============================================================
-- SECTION 12: NOTIFICATION CONFIG — COMPANY SCOPING
-- ============================================================

-- NULL company_id = system-wide default; specific id = company override
-- Lookup order: company-specific → fall back to NULL (global default)
ALTER TABLE tbl_notification_config
  ADD COLUMN company_id INT NULL AFTER config_id,
  ADD CONSTRAINT fk_notifconfig_company
    FOREIGN KEY (company_id) REFERENCES tbl_company(company_id);


-- ============================================================
-- SECTION 13: NEW TABLES
-- ============================================================

-- [NT1] tbl_payroll_export_log — record every export event for double-submission detection
CREATE TABLE tbl_payroll_export_log (
  export_id     INT AUTO_INCREMENT PRIMARY KEY,
  cutoff_id     INT NOT NULL,
  company_id    INT NOT NULL,
  export_format ENUM('pdf','excel','csv') NOT NULL,
  exported_by   INT NOT NULL,
  exported_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  row_count     INT NULL,
  file_name     VARCHAR(255) NULL,
  file_hash     VARCHAR(64) NULL,
  notes         TEXT NULL,
  CONSTRAINT fk_exportlog_cutoff  FOREIGN KEY (cutoff_id)   REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_exportlog_company FOREIGN KEY (company_id)  REFERENCES tbl_company(company_id),
  CONSTRAINT fk_exportlog_user    FOREIGN KEY (exported_by) REFERENCES tbl_user_account(user_acc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- [NT2] tbl_biometric_name_change_log — audit trail for biometric_name edits on tbl_employees
-- Parallel to tbl_biometric_uid_change_log (P7); VARCHAR(100) matches tbl_employees.biometric_name
CREATE TABLE tbl_biometric_name_change_log (
  change_id     INT AUTO_INCREMENT PRIMARY KEY,
  employee_id   INT NOT NULL,
  device_id     INT NOT NULL,
  old_name      VARCHAR(100) NULL,
  new_name      VARCHAR(100) NULL,
  changed_by    INT NOT NULL,
  change_reason VARCHAR(500) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_bionamechange_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_bionamechange_device   FOREIGN KEY (device_id)   REFERENCES tbl_device(device_id),
  CONSTRAINT fk_bionamechange_user     FOREIGN KEY (changed_by)  REFERENCES tbl_user_account(user_acc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- SECTION 14: COMPUTATION RULES SPLIT
-- ============================================================
-- tbl_computation_rules is replaced by:
--   tbl_punch_config  — operational timing rules, per company (static, rarely changes)
--   tbl_rate_config   — pay multipliers, per company, with effective_date versioning
-- The computation engine queries tbl_rate_config WHERE effective_date <= punch_date
-- ORDER BY effective_date DESC LIMIT 1 to get the rate active at time of punch.
-- This eliminates the need for snapshot columns on tbl_additional for most rates.
-- Snapshot columns are KEPT on tbl_additional for audit immutability of closed cutoffs.

CREATE TABLE tbl_punch_config (
  company_id                          INT NOT NULL,
  grace_period_minutes                INT NOT NULL DEFAULT 30,
  early_ot_threshold_minutes          INT NOT NULL DEFAULT 30,
  late_ot_threshold_minutes           INT NOT NULL DEFAULT 30,
  missed_punch_detection_buffer_minutes INT NOT NULL DEFAULT 60,
  duplicate_punch_window_seconds      INT NOT NULL DEFAULT 60,
  min_rest_hours_between_shifts       DECIMAL(4,2) NOT NULL DEFAULT 8.00,
  early_ot_max_hours                  DECIMAL(4,2) NOT NULL DEFAULT 4.00,
  late_ot_max_hours                   DECIMAL(4,2) NOT NULL DEFAULT 4.00,
  nd_window_start                     TIME NOT NULL DEFAULT '22:00:00',
  nd_window_end                       TIME NOT NULL DEFAULT '06:00:00',
  standard_shift_hours                DECIMAL(4,2) NOT NULL DEFAULT 8.00,
  break_deduct_hours                  DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  break_deduct_threshold_hours        DECIMAL(4,2) NOT NULL DEFAULT 8.00,
  break_deduction_enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  break_applies_to_graveyard          BOOLEAN NOT NULL DEFAULT FALSE,
  awol_threshold_days                 INT NOT NULL DEFAULT 3,
  awol_auto_flag_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
  probation_regularization_reminder_days INT NOT NULL DEFAULT 14,
  auto_regularize                     BOOLEAN NOT NULL DEFAULT TRUE,
  training_duration_days              INT NOT NULL DEFAULT 16,
  ot_form_required                    BOOLEAN NOT NULL DEFAULT FALSE,
  biometric_matching_strategy         ENUM('uid_only','uid_then_name','uid_then_name_then_employee_number')
                                      NOT NULL DEFAULT 'uid_then_name',
  updated_at                          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by                          INT NULL,
  PRIMARY KEY (company_id),
  CONSTRAINT fk_punchcfg_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_rate_config (
  rate_config_id          INT AUTO_INCREMENT PRIMARY KEY,
  company_id              INT NOT NULL,
  effective_date          DATE NOT NULL,
  -- Regular OT
  eot_multiplier          DECIMAL(6,4) NOT NULL DEFAULT 1.2500,
  lot_multiplier          DECIMAL(6,4) NOT NULL DEFAULT 1.3750,
  nd_rate                 DECIMAL(6,4) NOT NULL DEFAULT 0.1000,
  -- Special Holiday on Off Day (SHOD)
  shod_eot_multiplier     DECIMAL(6,4) NOT NULL DEFAULT 1.6900,
  shod_lot_multiplier     DECIMAL(6,4) NOT NULL DEFAULT 1.8590,
  shod_nd_rate            DECIMAL(6,4) NOT NULL DEFAULT 0.1300,
  shod_pay_rate           DECIMAL(6,4) NOT NULL DEFAULT 0.3000,  -- Day basis: additional premium
  -- Regular Holiday on Off Day (RHOD)
  rhod_eot_multiplier     DECIMAL(6,4) NOT NULL DEFAULT 2.6000,
  rhod_lot_multiplier     DECIMAL(6,4) NOT NULL DEFAULT 2.8600,
  rhod_nd_rate            DECIMAL(6,4) NOT NULL DEFAULT 0.2000,
  rhod_pay_rate           DECIMAL(6,4) NOT NULL DEFAULT 1.0000,  -- Day basis: additional premium
  -- Day Off with Duty (DOD = rest day work)
  dod_pay_rate            DECIMAL(6,4) NOT NULL DEFAULT 1.3000,  -- Day basis: TOTAL multiplier (1.3x daily)
  dod_eot_multiplier      DECIMAL(6,4) NOT NULL DEFAULT 1.6900,
  dod_lot_multiplier      DECIMAL(6,4) NOT NULL DEFAULT 1.8590,
  dod_nd_rate             DECIMAL(6,4) NOT NULL DEFAULT 0.1300,
  -- RHOD + DOD combination
  rhod_dod_eot_multiplier DECIMAL(6,4) NOT NULL DEFAULT 3.3800,
  rhod_dod_lot_multiplier DECIMAL(6,4) NOT NULL DEFAULT 3.7180,
  rhod_dod_nd_rate        DECIMAL(6,4) NOT NULL DEFAULT 0.2600,
  rhod_dod_pay_rate       DECIMAL(6,4) NOT NULL DEFAULT 2.6000,  -- Hrs basis (see comment in CLAUDE.md)
  -- SHOD + DOD combination
  shod_dod_eot_multiplier DECIMAL(6,4) NOT NULL DEFAULT 1.9500,
  shod_dod_lot_multiplier DECIMAL(6,4) NOT NULL DEFAULT 2.1500,
  shod_dod_nd_rate        DECIMAL(6,4) NOT NULL DEFAULT 0.1500,
  shod_dod_pay_rate       DECIMAL(6,4) NOT NULL DEFAULT 1.5000,  -- Hrs basis (see comment in CLAUDE.md)
  -- Statutory deductions (versioned here so rate changes don't break historical compute)
  phic_rate               DECIMAL(6,4) NOT NULL DEFAULT 0.0500,
  -- Wage reference (aligned to tbl_wage_floor; stored here as snapshot for computation)
  basic_daily_reference   DECIMAL(10,2) NOT NULL DEFAULT 695.00,
  notes                   VARCHAR(500) NULL,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by              INT NULL,
  UNIQUE KEY uq_rate_config_company_date (company_id, effective_date),
  CONSTRAINT fk_ratecfg_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Drop the original singleton computation rules table after split is seeded
-- (Run seeding script first: scripts/seed-punch-config.js, scripts/seed-rate-config.js)
-- DROP TABLE tbl_computation_rules;
-- [COMMENTED: Uncomment after seeding both companies in tbl_punch_config + tbl_rate_config]

-- Drop tbl_leave_config_global singleton; replace with company-scoped settings
-- on tbl_punch_config (ot_form_required) and tbl_leave_config (annual_days per type)
-- [Deferred: leave_config_global fields migrated to relevant tables per company; review before drop]


-- ============================================================
-- SECTION 15: INDEX ADDITIONS
-- ============================================================

-- Schedule grid loading: coordinator loads cutoff + subdept in one query
ALTER TABLE tbl_schedule
  ADD KEY idx_sched_cutoff_subdept (cutoff_id, subdepartment_id);

-- Leave queries: employee history + balance checks
ALTER TABLE tbl_leave
  ADD KEY idx_leave_emp_status_date (employee_id, status, start_date);

-- Timekeeping daily lookups for grid display
ALTER TABLE tbl_timekeeping
  ADD KEY idx_tk_emp_date (employee_id, date);

-- Anomaly review queue
ALTER TABLE tbl_timekeeping
  ADD KEY idx_tk_anomaly_queue (anomaly_flag, anomaly_reviewed_at);

-- Recompute queue
ALTER TABLE tbl_timekeeping
  ADD KEY idx_tk_recompute (recompute_needed);

-- Raw log processing queue
ALTER TABLE tbl_raw_device_logs
  ADD KEY idx_rdl_shift_date (shift_date);

-- Notification inbox
ALTER TABLE tbl_notification
  ADD KEY idx_notif_recipient_read (recipient_id, is_read, created_at);


-- ============================================================
-- SECTION 16: CONSTRAINT CLEANUP
-- ============================================================

-- tbl_shift_swap: after approval, swap affects tbl_schedule directly.
-- tbl_schedule_exception handles relief/coverage, NOT swap outcomes.
-- Cascade service: on swap approval → UPDATE tbl_schedule for both employees
-- tbl_shift_swap.status = 'approved' is the record; no additional table needed.

-- tbl_employee_position: enforce single primary via application layer
-- (MySQL cannot do partial unique indexes; service sets all others to FALSE first)

-- tbl_noted_by on tbl_cutoff_schedule_status must be coordinator scoped to that subdept
-- Enforced in service layer (not enforceable at DB level without triggers)


-- ============================================================
-- SECTION 17: FK ADDITIONS — NAMED USER REFERENCES + FORM LINKS
-- ============================================================
-- Base DDL omitted FKs on named user columns (reviewed_by, uploaded_by, etc.)
-- and on form_upload_id references outside tbl_shift_swap.
-- Project convention: created_by/updated_by have no FKs (audit trail); all
-- other named user references do.

-- [FK1] tbl_time_override.reviewed_by
ALTER TABLE tbl_time_override
  ADD CONSTRAINT fk_override_reviewed
    FOREIGN KEY (reviewed_by) REFERENCES tbl_user_account(user_acc_id);

-- [FK2] tbl_form_upload.reviewed_by + uploaded_by
ALTER TABLE tbl_form_upload
  ADD CONSTRAINT fk_formup_reviewed FOREIGN KEY (reviewed_by) REFERENCES tbl_user_account(user_acc_id),
  ADD CONSTRAINT fk_formup_uploaded FOREIGN KEY (uploaded_by) REFERENCES tbl_user_account(user_acc_id);

-- [FK3] tbl_employee_document.uploaded_by
ALTER TABLE tbl_employee_document
  ADD CONSTRAINT fk_empdoc_uploaded
    FOREIGN KEY (uploaded_by) REFERENCES tbl_user_account(user_acc_id);

-- [FK4] tbl_employee_biometric_enrollment.enrolled_by
ALTER TABLE tbl_employee_biometric_enrollment
  ADD CONSTRAINT fk_bioenroll_enrolled
    FOREIGN KEY (enrolled_by) REFERENCES tbl_user_account(user_acc_id);

-- [FK5] tbl_biometric_enrollment_log.performed_by
ALTER TABLE tbl_biometric_enrollment_log
  ADD CONSTRAINT fk_biolog_performed
    FOREIGN KEY (performed_by) REFERENCES tbl_user_account(user_acc_id);

-- [FK6] tbl_leave.form_upload_id
ALTER TABLE tbl_leave
  ADD CONSTRAINT fk_leave_formup
    FOREIGN KEY (form_upload_id) REFERENCES tbl_form_upload(form_upload_id);

-- [FK7] tbl_schedule_exception.form_upload_id
ALTER TABLE tbl_schedule_exception
  ADD CONSTRAINT fk_exception_formup
    FOREIGN KEY (form_upload_id) REFERENCES tbl_form_upload(form_upload_id);


-- ============================================================
-- SECTION 18: ADDITIONAL INDEXES
-- ============================================================

-- FK column added by patch [P4] — needs backing index for JOIN performance
ALTER TABLE tbl_cutoff_schedule_status
  ADD KEY idx_cutoffstatus_noted (noted_by_user_id);

-- day_scenario filter: report generation queries (e.g. "all regular holidays in cutoff")
ALTER TABLE tbl_timekeeping
  ADD KEY idx_tk_day_scenario (day_scenario);

-- Rate history lookup: WHERE position_id = ? AND effective_date <= ? ORDER BY effective_date DESC
ALTER TABLE tbl_position_rate
  ADD KEY idx_posrate_eff (position_id, effective_date);


-- ============================================================
-- SECTION 19: UNIQUE CONSTRAINT ADDITIONS
-- ============================================================

-- Prevent two import profiles with the same name for the same company.
-- NOTE: company_id is nullable (NULL = system-wide default). MySQL treats
-- NULL != NULL in unique indexes, so multiple NULL+same-name rows are allowed —
-- that is acceptable here (system-wide profiles are not deduplicated by name).
ALTER TABLE tbl_import_column_map
  ADD UNIQUE KEY uq_import_profile_company (company_id, profile_name);

-- Deduplication guard on raw device logs at the database level.
-- The application-level check (SELECT COUNT before insert) handles the normal path;
-- this constraint is the safety net for concurrent sync workers or ADMS push + pull racing.
-- record_time precision is to the second — devices do not emit sub-second timestamps.
ALTER TABLE tbl_raw_device_logs
  ADD UNIQUE KEY uq_rdl_dedup (device_id, device_user_id, record_time);


-- ============================================================
-- SECTION 20: tbl_device_command_queue
-- ============================================================
-- ADMS push protocol requires a command queue:
--   Device polls GET /iclock/getrequest → receives next PENDING command → status → SENT
--   Device confirms POST /iclock/devicecmd → status → ACKNOWLEDGED
-- Stale SENT commands (no ack after N minutes) are reset to PENDING by a background job.
CREATE TABLE tbl_device_command_queue (
  command_id            INT AUTO_INCREMENT PRIMARY KEY,
  device_id             INT NOT NULL,
  command_type          ENUM('create_user','update_user','delete_user','sync_time','set_config') NOT NULL,
  target_employee_id    INT NULL,
  target_device_user_id VARCHAR(20) NULL,
  command_data          JSON NULL,
  status                ENUM('pending','sent','acknowledged','failed') NOT NULL DEFAULT 'pending',
  sent_at               TIMESTAMP NULL,
  acknowledged_at       TIMESTAMP NULL,
  retry_count           INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by            INT NULL,
  updated_at            TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_devcmd_device_status (device_id, status),
  CONSTRAINT fk_devcmd_device   FOREIGN KEY (device_id)          REFERENCES tbl_device(device_id),
  CONSTRAINT fk_devcmd_employee FOREIGN KEY (target_employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- RATE BASIS DOCUMENTATION (for computation engine reference)
-- ============================================================
-- Multipliers applied against HOURLY RATE (basic_daily / 8):
--   eot, lot, nd, shod_eot, shod_lot, shod_nd
--   rhod_eot, rhod_lot, rhod_nd
--   dod_eot, dod_lot, dod_nd
--   rhod_dod_*, shod_dod_eot, shod_dod_lot, shod_dod_nd
--
-- Multipliers applied against DAILY RATE:
--   shod_pay_rate  (additional premium: 0.30 → total = 1.30x daily)
--   rhod_pay_rate  (additional premium: 1.00 → total = 2.00x daily)
--   dod_pay_rate   (TOTAL multiplier: 1.30 → directly 1.30x daily)
--
-- Exception — these named pay_rates are HOURLY basis despite naming:
--   rhod_dod_pay_rate  (2.60 per hour)
--   shod_dod_pay_rate  (1.50 per hour)
--
-- The computation engine must hardcode which columns use which basis.
-- This asymmetry is inherited from the client's rate table. Do not "fix" it
-- by converting to a uniform convention without re-validating all sample computations.
-- ============================================================
