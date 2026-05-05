-- ============================================================
-- MINERVA HRIS — Seed and Finalize
-- Version: 003 (applies on top of 002_patches.sql)
-- Last updated: 2026-04-27
-- ============================================================
-- PURPOSE:
--   1. Seed tbl_punch_config — one row per company (operational thresholds)
--   2. Seed tbl_rate_config  — one row per company, effective 2026-01-01
--   3. Drop tbl_computation_rules (replaced by the two tables above)
--
-- PREREQUISITES — must be done BEFORE running this file:
--   a. Run 001_init.sql  (v5.0 base DDL — creates all base tables)
--   b. Run 002_patches.sql (creates tbl_punch_config + tbl_rate_config schema)
--   c. Run the company bootstrap / seed-users scripts so that tbl_company
--      already has rows for UTH (company_id=1) and SSH (company_id=2).
--      If tbl_company is empty, this file will insert zero rows and the
--      computation engine will find no config at startup — causing hard errors.
--
-- SAFE TO RE-RUN: INSERT IGNORE means existing rows are not overwritten.
-- To change a value after initial seed: use UPDATE, not re-run.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- SECTION 0: tbl_company — BASE COMPANY SEED
-- ============================================================
-- Ensures UTH (company_id=1) and SSH (company_id=2) exist before any
-- FK-referencing inserts in this file and in 004/005.
-- INSERT IGNORE: safe to re-run; existing rows are untouched.
-- cutoff_anchor_date = '2026-01-11' = PH standard period-1 anchor (11th of month).
-- Update company details (legal_entity_name, tin, address, etc.) via the UI after deploy.
INSERT IGNORE INTO tbl_company (company_id, company_name, cutoff_anchor_date, is_active)
VALUES
  (1, 'Urban Travellers Hotel', '2026-01-11', TRUE),
  (2, 'Shogun Suite Hotel',     '2026-01-11', TRUE);


-- ============================================================
-- SECTION 1: tbl_punch_config — operational thresholds per company
-- ============================================================
-- One row per company. All values are defaults from CLAUDE.md and schema audit.
-- Fields not listed here use their column DEFAULT values.
-- Update via the settings UI or direct UPDATE after initial seed.

INSERT IGNORE INTO tbl_punch_config (
  company_id,
  grace_period_minutes,
  early_ot_threshold_minutes,
  late_ot_threshold_minutes,
  missed_punch_detection_buffer_minutes,
  duplicate_punch_window_seconds,
  min_rest_hours_between_shifts,
  early_ot_max_hours,
  late_ot_max_hours,
  nd_window_start,
  nd_window_end,
  standard_shift_hours,
  break_deduct_hours,
  break_deduct_threshold_hours,
  break_deduction_enabled,
  break_applies_to_graveyard,
  awol_threshold_days,
  awol_auto_flag_enabled,
  probation_regularization_reminder_days,
  auto_regularize,
  training_duration_days,
  ot_form_required,
  biometric_matching_strategy
)
SELECT
  c.company_id,
  30,           -- grace_period_minutes
  30,           -- early_ot_threshold_minutes
  30,           -- late_ot_threshold_minutes
  60,           -- missed_punch_detection_buffer_minutes
  60,           -- duplicate_punch_window_seconds (from CLAUDE.md)
  8.00,         -- min_rest_hours_between_shifts
  4.00,         -- early_ot_max_hours
  4.00,         -- late_ot_max_hours
  '22:00:00',   -- nd_window_start (PH DOLE: 10PM–6AM)
  '06:00:00',   -- nd_window_end
  8.00,         -- standard_shift_hours
  1.00,         -- break_deduct_hours
  8.00,         -- break_deduct_threshold_hours
  TRUE,         -- break_deduction_enabled
  FALSE,        -- break_applies_to_graveyard (confirmed default: no deduction for graveyard)
  3,            -- awol_threshold_days
  TRUE,         -- awol_auto_flag_enabled
  14,           -- probation_regularization_reminder_days
  TRUE,         -- auto_regularize
  16,           -- training_duration_days
  FALSE,        -- ot_form_required (PH law: must pay OT regardless of form)
  'uid_then_name_then_employee_number'  -- biometric_matching_strategy (three-tier CLAUDE.md)
FROM tbl_company c;


-- ============================================================
-- SECTION 2: tbl_rate_config — pay multipliers per company, effective 2026-01-01
-- ============================================================
-- One row per company, effective from 2026-01-01.
-- Multiplier basis (from schema_decisions.md rate table audit):
--   eot/lot/nd/shod_*/rhod_*  → applied to HOURLY RATE (basic_daily / 8)
--   shod_pay_rate, rhod_pay_rate, dod_pay_rate → applied to DAILY RATE
--   rhod_dod_pay_rate, shod_dod_pay_rate → applied to HOURLY RATE (exception)
-- basic_daily_reference: aligned to current Manila minimum wage (₱695.00)

INSERT IGNORE INTO tbl_rate_config (
  company_id,
  effective_date,
  eot_multiplier,
  lot_multiplier,
  nd_rate,
  shod_eot_multiplier,
  shod_lot_multiplier,
  shod_nd_rate,
  shod_pay_rate,
  rhod_eot_multiplier,
  rhod_lot_multiplier,
  rhod_nd_rate,
  rhod_pay_rate,
  dod_pay_rate,
  dod_eot_multiplier,
  dod_lot_multiplier,
  dod_nd_rate,
  rhod_dod_eot_multiplier,
  rhod_dod_lot_multiplier,
  rhod_dod_nd_rate,
  rhod_dod_pay_rate,
  shod_dod_eot_multiplier,
  shod_dod_lot_multiplier,
  shod_dod_nd_rate,
  shod_dod_pay_rate,
  phic_rate,
  basic_daily_reference,
  notes
)
SELECT
  c.company_id,
  '2026-01-01',   -- effective_date
  -- Regular OT (hourly basis)
  1.2500,         -- eot_multiplier  (early OT: 1.25x hourly)
  1.3750,         -- lot_multiplier  (late OT: 1.375x hourly — PH 125% + 10%)
  0.1000,         -- nd_rate         (night diff: +10% of hourly)
  -- Special Holiday on Off Day (hourly basis)
  1.6900,         -- shod_eot_multiplier
  1.8590,         -- shod_lot_multiplier
  0.1300,         -- shod_nd_rate
  0.3000,         -- shod_pay_rate   (daily basis: +30% premium — total 1.30x daily)
  -- Regular Holiday on Off Day (hourly basis)
  2.6000,         -- rhod_eot_multiplier
  2.8600,         -- rhod_lot_multiplier
  0.2000,         -- rhod_nd_rate
  1.0000,         -- rhod_pay_rate   (daily basis: +100% premium — total 2.00x daily)
  -- Day Off with Duty / Rest Day Work (daily basis)
  1.3000,         -- dod_pay_rate    (daily basis: TOTAL 1.30x — confirmed from rate table; 0.13 was typo)
  1.6900,         -- dod_eot_multiplier (hourly basis)
  1.8590,         -- dod_lot_multiplier (hourly basis)
  0.1300,         -- dod_nd_rate     (hourly basis)
  -- RHOD + DOD combination (hourly basis for pay_rate — exception)
  3.3800,         -- rhod_dod_eot_multiplier
  3.7180,         -- rhod_dod_lot_multiplier
  0.2600,         -- rhod_dod_nd_rate
  2.6000,         -- rhod_dod_pay_rate  (hourly basis — exception to day-basis naming)
  -- SHOD + DOD combination (hourly basis for pay_rate — exception)
  1.9500,         -- shod_dod_eot_multiplier
  2.1500,         -- shod_dod_lot_multiplier
  0.1500,         -- shod_dod_nd_rate
  1.5000,         -- shod_dod_pay_rate  (hourly basis — exception to day-basis naming)
  -- Statutory
  0.0500,         -- phic_rate (5% employer + employee combined; confirm split if needed)
  695.00,         -- basic_daily_reference (Manila NCR minimum wage 2026)
  'Initial seed — based on rate table audit 2026-04-27. dod_pay_rate 1.30 confirmed (0.13 was typo).'
FROM tbl_company c;


-- ============================================================
-- SECTION 3: DROP tbl_computation_rules (FINALIZE SPLIT)
-- ============================================================
-- This table is now fully replaced by tbl_punch_config + tbl_rate_config.
-- All columns have been mapped:
--   duplicate_punch_window_seconds → tbl_punch_config
--   grace_period_minutes           → tbl_punch_config
--   break_applies_to_graveyard     → tbl_punch_config
--   break_deduction_enabled        → tbl_punch_config
--   nd_window_start / nd_window_end→ tbl_punch_config
--   All rate multipliers           → tbl_rate_config
--   biometric_matching_strategy    → tbl_punch_config
--
-- VERIFY before running:
--   SELECT * FROM tbl_punch_config;   -- expect one row per company
--   SELECT * FROM tbl_rate_config;    -- expect one row per company
--
-- DEPENDENCY CHECK: If any stored procedures or views reference
-- tbl_computation_rules, update them before dropping.
-- For MINERVA v1.0, no stored procedures exist.

DROP TABLE IF EXISTS tbl_computation_rules;


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- VERIFICATION QUERIES (run after applying this file)
-- ============================================================
-- SELECT company_id, grace_period_minutes, duplicate_punch_window_seconds,
--        break_applies_to_graveyard, biometric_matching_strategy
-- FROM tbl_punch_config;
--
-- SELECT company_id, effective_date, eot_multiplier, dod_pay_rate, nd_rate
-- FROM tbl_rate_config
-- ORDER BY company_id, effective_date;
--
-- SHOW TABLES LIKE 'tbl_computation_rules';  -- must return 0 rows
-- ============================================================
