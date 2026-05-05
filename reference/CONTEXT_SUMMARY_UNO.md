# MINERVA HRIS — Complete Context Summary
**Purpose:** Paste this into a new Claude chat to continue without losing context.  
**Last updated:** April 25, 2026  
**Status:** Schema finalized (v5.0). Frontend prototype and documentation not yet produced.

---

## 1. ORIGINAL GOAL

Design a complete, production-ready MySQL database schema for an HRIS (Human Resource Information System) serving two hotel companies on a shared database instance:

- **Urban Travellers Hotel (UTH)** — Pasay Taft Tourist Dev. Inc.
- **Shogun Suite Hotel (SSH)** — H&R Business Dev. Inc.

The system is called **Minerva**. It handles employee management, biometric attendance, schedule management, timekeeping computation, leave tracking, override workflows, and payroll-adjacent reporting.

A second, separate product called **Julie** is planned as a general-purpose, SaaS-ready version for other clients. The schema is designed to be a compatible subset of Julie's eventual full schema. Julie-only features are marked with `[JULIE ONLY]` in the schema comments.

---

## 2. DUAL-BUILD PHILOSOPHY (CRITICAL — READ FIRST)

| | Minerva | Julie |
|---|---|---|
| **Scope** | This specific client (UTH + SSH) | General-purpose, any client |
| **Tenancy** | Two employers, fixed | Multi-tenant from root |
| **Biometric** | ZKTeco UF100 only | Plug-and-play multi-brand |
| **Leaves** | VL + SL only (active) | All statutory PH leave types |
| **Payroll** | Loosely integrated (export-only) | Same but more complete |
| **Config** | Configurable but client-scoped | Fully configurable per deployment |
| **Status** | Active development | Planned post-Minerva |

**Key rule:** Every table and column added for Minerva must be forward-compatible with Julie. Julie extends Minerva; Minerva does not block Julie.

---

## 3. TECHNOLOGY STACK

- **Frontend:** Vanilla HTML/CSS/JS, SPA with hash-based routing (`index.html#/route`)
- **Backend:** Node.js + Express
- **Database:** MySQL (InnoDB, utf8mb4)
- **Biometric:** ZKTeco UF100 via `node-zklib` TCP bridge
- **Real-time:** WebSocket for live biometric feed on dashboards
- **Session:** JWT stored in `localStorage` as `hris_token` + `hris_role`

---

## 4. DEVELOPMENT TIMELINE

| Date | Target |
|---|---|
| **April 25, 2026** | Static frontend prototype (all pages, all roles, mock data — no backend wiring) |
| **April 27, 2026** | Timekeeping MVP + biometric integration live |
| **Post-April 30** | Everything else (full wiring, all modules, reports, service charges, 13th month) |

**Brutal reality check on the timeline:** April 25 for a full static prototype covering all 5 roles, all modules, and all flows is aggressive for one person. April 27 for live timekeeping + biometric is even more so. These are aspirational targets. Biometric integration (ZK bridge + reconciliation + anomaly detection) alone typically takes a week. The developer should plan for prototype by ~April 28 and live timekeeping by ~May 5 as realistic targets. Do not sacrifice schema quality or architecture to hit dates.

---

## 5. ROLES (5 TOTAL)

| Role | Enum value | Description |
|---|---|---|
| Super Admin | `super_admin` | One per instance. Created by bootstrap account at onboarding. System-wide config access. |
| HR Admin | `hr` | Full CRUD, leave/override approval, reports, settings (rules, holidays, leave config) |
| Coordinator/OIC | `coord` | Scoped to assigned subdepts. Schedule drafting, form endorsement, request submission. |
| IT Admin | `it` | Device mgmt, user accounts, org structure, override submission (cannot approve) |
| Admin | `admin` | View-only. Same pages as HR minus settings, write actions, and payroll data. |

**Bootstrap account:** Created by migration script during onboarding. `is_bootstrap=true`, cannot be reactivated once deactivated. Deactivated after first real super_admin account is confirmed.

**Scoping:** Both `coord` AND `hr` accounts can be scoped to specific subdepartments via `tbl_user_scope`. HR Admins with scope only see their assigned subdepts. `tbl_module_access` provides per-account module-level permission overrides on top of role defaults.

**Onboarding sequence:**
1. Bootstrap account created by migration
2. Super admin creates company setup (name, legal entity, TIN, region, cutoff anchor)
3. IT Admin creates departments → subdepts → positions
4. Coordinators configure shift presets + shift slots for their subdepts
5. HR configures computation rules, leave types, holidays
6. IT creates user accounts
7. IT imports employees (bulk) or HR adds individually
8. IT registers biometric devices + enrolls employees
9. First cutoff generated

---

## 6. KEY ARCHITECTURAL DECISIONS

### 6.1 No Hard Deletes
All tables use `is_active` boolean. Records are never physically deleted. `tbl_audit_log` is additionally append-only (REVOKE UPDATE/DELETE at DB level).

### 6.2 Employee Number Format (Client-Specific)
Format: `1-052722-248` where:
- `1` = format prefix
- `052722` = hire date (MMDDYY)
- `248` = biometric device user ID

This is a Minerva/client-specific convention. The unique constraint on employee number is `(employee_number, company_id)` — not system-wide — because UTH and SSH employees may share the same number space.

**For Julie:** Employee number format is arbitrary. The `biometric_device_uid` on `tbl_employees` is always the authoritative reconciliation key, not the employee number.

### 6.3 Salary Three-Tier System
Precedence (highest wins):
1. `tbl_employees.basic_salary` — individual override
2. `tbl_position_rate` — position + company rate (with `effective_date` and `wage_order_reference`)
3. `tbl_wage_floor` — regional minimum wage floor by region

Salary tiers (Level III, IV-A, V, etc.) are stored as `salary_band_label` on `tbl_position_rate`. They are labels, not hard constraints. Individual salaries can differ from the band.

### 6.4 Leave Allocation Model
Minerva uses **tenure-based** allocation: 5 days year 1, 6 days year 2, 7 days year 3+ (capped at 7). Configured in `tbl_leave_tier_config`.

`tbl_leave_config_global.leave_allocation_mode` controls which model is active: `employment_type | tenure | position | combined`. For Minerva: `tenure`.

**Year-end behavior (Minerva):**
- VL unused → Forced Vacation Leave (FVL) initiated by HR before year end. `leave_initiation_type='forced_leave'`.
- SL unused → cashed out at year end. `cash_payout_amount` and `payout_date` on `tbl_leave_balance`.
- No carryover. `carryover_credits` always 0 for this client.
- Both VL and SL reset to 0 at year end.

### 6.5 Split Shifts (Broken-Time Schedule)
F&B and Kitchen subdepts use split shifts (e.g., `4AM-12NN/12NN-2PM`). These are legal under DOLE DA 2-09 (Broken-Time Schedule) but require DOLE notification.

**Key finding from schedule analysis:** All observed split shifts start with an 8-hour primary block followed by a 2–4 hour continuation block. The continuation is always OT (total daily hours > 8 triggers OT threshold).

**Schema approach:**
- `tbl_schedule.continuation_shift_id` stores the second shift preset
- `tbl_schedule.flex_time_in/flex_time_out` stores the continuation block times
- `tbl_timekeeping` has `segment_order` (1=primary, 2=continuation) with unique key `(employee_id, date, segment_order)`
- `total_hours_day` is the cumulative sum across all segments for OT computation
- `gap_minutes_before_segment` flags broken-time gaps for HR review

### 6.6 Timekeeping Comparison Flow
The system continuously compares **assigned schedule** (from `tbl_schedule` + `tbl_shift`) against **actual punches** (from `tbl_raw_device_logs`). This is the core timekeeping engine:

```
tbl_raw_device_logs → reconciliation → tbl_timekeeping
tbl_schedule → scheduled_time_in/out → tbl_timekeeping
Computation engine compares → sets is_late, late_minutes, ot_approval_status, anomaly_flag
tbl_deduction + tbl_additional + tbl_dod populated from computed values
```

Net Total Formula:
```
Net Total = Regular Hours + Early OT + Late OT + Night Diff + DOD OT + DOD ND
            - Late - Undertime - Half-day - Break Deduction
```

### 6.7 Biometric Reconciliation (Three-Tier Matching)
1. **Primary:** `tbl_raw_device_logs.device_user_id` → `tbl_employees.biometric_device_uid`
2. **Fallback:** `tbl_raw_device_logs.employee_name_raw` → `tbl_employees.biometric_name`
3. **Client-specific (Minerva only):** Extract last 3 digits of `employee_number` → compare to `device_user_id`

Configured via `tbl_computation_rules.biometric_matching_strategy`:
`uid_only | uid_then_name | uid_then_name_then_employee_number`

**Conflict prevention:** `tbl_employee_biometric_enrollment` has `UNIQUE (device_id, device_user_id)` — no two employees can share the same UID on the same device. Before pushing a UID to the device, the system calls ZK SDK's `getUsers()` to verify no conflict. Conflicts logged to `tbl_biometric_enrollment_log`.

**Push-to-device:** Setting `biometric_device_uid` in Minerva requires also updating the ZKTeco device via the ZK SDK (create/update user on device with matching ID). The fingerprint template must still be enrolled physically. The UID can be set remotely. `biometric_sync_status` on `tbl_employees` tracks state: `not_enrolled | enrolled | sync_pending | sync_conflict | sync_failed`.

### 6.8 Punch Flow & Edge Cases (Documented for Implementation)
These are documented for the developer — not yet implemented in schema as columns, but the schema supports them via flags:

| Problem | Handling |
|---|---|
| Early bird vs Early OT | `early_ot_threshold_minutes` config. Within threshold = on-time. Beyond = flag + coordinator confirm |
| Late OT | `late_ot_threshold_minutes`. Same logic. |
| Ghost punch (AWOL return) | Coordinator `anomaly_flag` + `supervisor_verified` attestation. Rapid succession punch detection. |
| Missed punch | `missed_punch_detection_buffer_minutes`. Flags via `MISSED_PUNCH_DETECTED` notification. |
| Double-tap / duplicate | `duplicate_punch_window_seconds` (default 60s). Second punch in window rejected. |
| Punch direction error | `override_type = 'incorrect_punch_direction'` in `tbl_time_override`. |
| Meal break abuse | Auto-deduct `break_deduct_hours` for shifts > `break_deduct_threshold_hours`. `break_verified` flag for supervisor attestation. No punch-monitoring for breaks (too easy to abuse). |
| Near-window punches | Within OT threshold → absorbed as on-time. No rounding. |
| OT without form | `ot_approval_status = 'flagged_no_form'`. OT still credited (PH law requires payment even without form approval). HR notified via `OT_FLAGGED_NO_FORM`. |
| ND meal break | Break during ND hours may still be compensable if employee on-call. Flagged for HR review. |
| Graveyard + second shift same day | Two separate timekeeping rows for two different dates. The 6AM punch-out is dated to the previous day's record (shift start date rule). The 2PM punch-in is a new record for today. No conflict. |

### 6.9 201/202 File System
- **201 file (active employee):** `is_active = TRUE`
- **202 file (separated employee):** `is_active = FALSE` with `date_separated` populated
- `tbl_employee_document` stores scanned/uploaded documents per employee (digital 201 file)
- No hard delete — records are retained permanently

### 6.10 Service Charges (DOLE DO 242-2024)
Under R.A. 11360 and DOLE DO 242-2024: 100% of service charges distributed to ALL covered employees (excluding managerial, per `tbl_position.is_managerial`) proportional to actual hours worked. Must be distributed at minimum every 16 days (aligns with 15-day cutoff). Schema prepared (`tbl_service_charge`, `tbl_service_charge_distribution`) but **UI and computation deferred post-MVP**.

### 6.11 13th Month Pay
Mandatory for all rank-and-file employees. Formula: total basic salary earned in calendar year ÷ 12. Excludes managerial employees. Must be paid by Dec 24; DOLE compliance report due Jan 15. Schema prepared (`tbl_13th_month_pay`) but **loosely integrated — Minerva computes and flags; external payroll disburses**.

### 6.12 Configuration Table Split (Not a God Table)
`tbl_computation_rules` was split into domain tables to avoid god-table antipattern:

| Table | Contents |
|---|---|
| `tbl_computation_rules` | 22-rate multipliers + punch window timings + AWOL/probation/OT config |
| `tbl_leave_config_global` | Leave allocation mode, year-end behavior, carry-over |
| `tbl_system_config` | Security, session, audit retention |
| `tbl_notification_config` | Per-trigger notification routing |
| `tbl_computation_rules` | Also holds `biometric_matching_strategy` |

Cutoff anchor dates, cycle lengths are on `tbl_company` (per-employer). Basic salary floors are in `tbl_wage_floor` (by region).

---

## 7. PHILIPPINE LABOR LAW NOTES (Embedded in Schema)

| Topic | Rule | Schema Impact |
|---|---|---|
| Probationary period | 180 calendar days from first day of work. NOT configurable. Cannot be extended. | `date_hired` is legal start. `probationary_start_date` is operational label only. |
| Training period | Not a legal category. Client calls first 16 days "training" but legally employment and probation clock start from day 1 of work. | `training_duration_days = 16` configurable in `tbl_computation_rules`. |
| Overtime | Any work beyond 8 hours per calendar day. Threshold is daily total, not per shift block. | `total_hours_day` in `tbl_timekeeping`. OT = cumulative hours > 8. |
| Overtime payment | Employer must pay OT regardless of whether a form was filed, if work was actually performed and employer benefited. | `ot_form_required = FALSE` default. OT always computed from punches. Flagged if no form. |
| Night differential | 10PM–6AM window (configurable). | `nd_window_start`, `nd_window_end` in `tbl_computation_rules`. |
| Meal break | 60 minutes non-compensable (standard). Compensable if employee required to stay on-call or break occurs during OT/ND hours. | `break_deduct_hours`, `break_verified` flag. |
| SIL (Service Incentive Leave) | 5 days minimum after 1 year of service. Client exceeds this with 5/6/7 tier. | `tbl_leave_tier_config`. |
| Forced Leave | Legal under DOLE DA 2-09. Full pay required. DOLE must be notified. | `leave_initiation_type = 'forced_leave'`. `tbl_dole_notification`. |
| Broken-Time Schedule | Legal under DOLE DA 2-09. DOLE must be notified. | `tbl_dole_notification`. Flag on `tbl_company`. |
| Service charges | R.A. 11360 + DOLE DO 242-2024: 100% to covered employees, proportional to hours worked, at least every 16 days. | `tbl_service_charge`, `tbl_service_charge_distribution`. |
| 13th month pay | Mandatory for all rank-and-file. Formula: YTD basic ÷ 12. Paid by Dec 24. | `tbl_13th_month_pay`. `is_managerial` on `tbl_position` for exclusion. |
| Minimum wage (NCR) | ₱695/day as of 2026 (Wage Order NCR-26). Regional, not by position. | `tbl_wage_floor` by region. Warning when individual/position salary below floor. |
| Rest day | At least 24 consecutive hours per 7-day period. No daily minimum rest between shifts. | `min_rest_hours_between_shifts` in `tbl_computation_rules` (configurable warning only). |
| Relievers | No special legal category. Same statutory rights as regular employees from day 1. Repeated use may regularize them. | `is_reliever` flag on `tbl_schedule`. Employment type handles classification. |
| SL encashment | Unused SL beyond statutory SIL may be encashed per company policy. Client does this at year end. | `is_cash_convertible` on `tbl_leave_type`. `cash_payout_amount` on `tbl_leave_balance`. |

---

## 8. MODULE ARCHITECTURE (What Pages/Features Exist)

### 8.1 Module List

| Module | Route | Roles | Priority |
|---|---|---|---|
| Auth & Session | `/login`, `/` | All | MVP |
| Dashboard | `#/dashboard` | All | MVP |
| Employee Masterlist | `#/employees` | HR, Coord (read-only) | MVP |
| Schedule Grid | `#/schedule` | HR, Coord | MVP |
| Timekeeping | `#/timekeeping` | HR, Coord, IT | MVP |
| Requests | `#/requests` | HR, Coord, IT | Post-MVP |
| Settings | `#/settings` | HR, IT | MVP (static prototype) |
| Reports | `#/reports` | HR, Admin | Post-MVP |
| Devices | `#/devices` | IT | MVP (biometric) |
| Audit Log | `#/audit` | HR, IT | Post-MVP |

### 8.2 Schedule Grid Architecture
- **Rows:** Employees
- **Columns:** Dates of cutoff period
- **Cells:** Assigned shift or status annotation (OFF, LEAVE, DOD, FVL, etc.)
- **Shift slots:** Named grid columns per subdept (e.g., F&B has Breakfast, Restobar, Closer, Reliever). Managed in `tbl_shift_slot`.
- **`slot_order`:** Integer that determines the left-to-right display order of shift slot columns. 1 = leftmost column.
- **Stations:** Operational sub-groupings within a subdept (e.g., Breakfast station vs Restobar station). Nullable on `tbl_schedule`. Only F&B and Kitchen use this currently.
- **Annotations:** Date-level status flags set by coordinator at draft time (`tbl_schedule_date_annotation`): off, day_off, dod, fvl, regular_ot, change_off, absent, on_leave, etc. These activate computation flags in timekeeping.

### 8.3 Timekeeping Grid
Compares `tbl_schedule` (what they should work) vs `tbl_raw_device_logs` (what they actually did). Key columns per row:
- Employee, Date, Assigned shift (time_in/time_out from schedule), Actual punch-in, Actual punch-out, Hours worked, OT, UT, Deductions, Status, Override flag.

---

## 9. COMPLETE SCHEMA (v5.0)

```sql
-- ============================================================
-- MINERVA HRIS — Complete Database Schema
-- Version: 5.0 (Finalized Pre-Documentation Pass)
-- Scope: Minerva (client-specific) with Julie-ready extensions
-- Companies: Urban Travellers Hotel (UTH) + Shogun Suite Hotel (SSH)
-- ============================================================
-- Design Rules:
--   1. No hard deletes. All deactivations use is_active flags.
--   2. All tables carry created_at, created_by, updated_at, updated_by.
--   3. Every significant action writes to tbl_audit_log (append-only).
--   4. Monetary values use decimal(10,2). Never int.
--   5. ip_address fields use varchar(45) for IPv4 and IPv6.
--   6. Grace period and time window values stored in minutes.
--   7. Coordinator accounts scoped via tbl_user_scope.
--   8. Timekeeping for midnight-crossing shifts dated to shift start date.
--   9. No ON DELETE CASCADE on any FK. Use is_active for deactivation.
--  10. Julie-only features marked with -- [JULIE ONLY] comments.
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE tbl_company (
  company_id          INT AUTO_INCREMENT PRIMARY KEY,
  company_name        VARCHAR(150) NOT NULL,
  legal_entity_name   VARCHAR(200) NULL,
  tin                 VARCHAR(30) NULL,
  address             VARCHAR(300) NULL,
  province            VARCHAR(100) NULL,
  contact_person      VARCHAR(100) NULL,
  contact_number      VARCHAR(20) NULL,
  email               VARCHAR(100) NULL,
  sss_employer_number VARCHAR(30) NULL,
  philhealth_employer_number VARCHAR(30) NULL,
  pagibig_employer_number    VARCHAR(30) NULL,
  region              VARCHAR(100) NULL,
  cutoff_anchor_date  DATE NULL,
  cutoff_cycle_days   INT NOT NULL DEFAULT 15,
  dole_notified_broken_time   BOOLEAN NOT NULL DEFAULT FALSE,
  dole_notified_forced_leave  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          INT NULL,
  updated_at          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by          INT NULL,
  UNIQUE KEY uq_company_name (company_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_wage_floor (
  wage_floor_id   INT AUTO_INCREMENT PRIMARY KEY,
  region          VARCHAR(100) NOT NULL,
  daily_rate      DECIMAL(10,2) NOT NULL,
  monthly_rate    DECIMAL(10,2) NOT NULL,
  effective_date  DATE NOT NULL,
  wage_order_ref  VARCHAR(100) NULL,
  notes           TEXT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      INT NULL,
  UNIQUE KEY uq_wage_floor_region_date (region, effective_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_department (
  department_id   INT AUTO_INCREMENT PRIMARY KEY,
  company_id      INT NOT NULL,
  department_name VARCHAR(100) NOT NULL,
  department_code VARCHAR(20) NULL,
  description     TEXT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      INT NULL,
  updated_at      TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by      INT NULL,
  UNIQUE KEY uq_dept_name_company (department_name, company_id),
  CONSTRAINT fk_dept_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_subdepartment (
  subdepartment_id   INT AUTO_INCREMENT PRIMARY KEY,
  department_id      INT NOT NULL,
  company_id         INT NOT NULL,
  subdepartment_name VARCHAR(100) NOT NULL,
  subdepartment_code VARCHAR(20) NULL,
  description        TEXT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  updated_at         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by         INT NULL,
  UNIQUE KEY uq_subdept_name_dept (subdepartment_name, department_id),
  CONSTRAINT fk_subdept_dept    FOREIGN KEY (department_id) REFERENCES tbl_department(department_id),
  CONSTRAINT fk_subdept_company FOREIGN KEY (company_id)   REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_position (
  position_id      INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  position_name    VARCHAR(150) NOT NULL,
  position_code    VARCHAR(20) NULL,
  is_managerial    BOOLEAN NOT NULL DEFAULT FALSE,
  min_employees    INT NULL,
  description      TEXT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_position_name_subdept (position_name, subdepartment_id),
  CONSTRAINT fk_position_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_station (
  station_id       INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  station_name     VARCHAR(100) NOT NULL,
  is_seasonal      BOOLEAN NOT NULL DEFAULT FALSE,
  season_start_month TINYINT NULL,
  season_end_month   TINYINT NULL,
  notes            VARCHAR(500) NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_station_name_subdept (station_name, subdepartment_id),
  CONSTRAINT fk_station_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employment_type (
  employment_type_id INT AUTO_INCREMENT PRIMARY KEY,
  employment_type    VARCHAR(60) NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  updated_at         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by         INT NULL,
  UNIQUE KEY uq_employment_type (employment_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_status (
  employee_status_id INT AUTO_INCREMENT PRIMARY KEY,
  employment_status  VARCHAR(60) NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  updated_at         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by         INT NULL,
  UNIQUE KEY uq_employee_status (employment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employees (
  employee_id            INT AUTO_INCREMENT PRIMARY KEY,
  employee_number        VARCHAR(30) NOT NULL,
  last_name              VARCHAR(60) NOT NULL,
  first_name             VARCHAR(60) NOT NULL,
  middle_name            VARCHAR(60) NULL,
  middle_initial         CHAR(1) NULL,
  name_suffix            VARCHAR(10) NULL,
  company_id             INT NOT NULL,
  department_id          INT NOT NULL,
  subdepartment_id       INT NOT NULL,
  employment_type_id     INT NOT NULL,
  employee_status_id     INT NOT NULL,
  date_hired             DATE NOT NULL,
  training_start_date    DATE NULL,
  training_end_date      DATE NULL,
  probationary_start_date DATE NULL,
  date_regularized       DATE NULL,
  date_separated         DATE NULL,
  separation_type        ENUM('resigned','end_of_contract','terminated_just_cause',
                              'terminated_authorized_cause','awol','retirement','death') NULL,
  separation_reason      VARCHAR(500) NULL,
  final_clearance        BOOLEAN NULL,
  schedule_eligible_from_cutoff_id INT NULL,
  basic_salary           DECIMAL(10,2) NULL,
  previous_salary        DECIMAL(10,2) NULL,
  allowance              DECIMAL(10,2) NULL,
  has_allowance_integrated BOOLEAN NOT NULL DEFAULT FALSE,
  payroll_type           ENUM('Monthly','Semi-monthly','Weekly','Daily') NULL,
  payroll_cycle          ENUM('Monthly','Semi-monthly','Weekly','Daily') NULL,
  pay_class              ENUM('Salaried','Daily-paid','Hourly') NULL,
  pay_factor             SMALLINT NULL DEFAULT 313,
  payroll_account_number VARCHAR(60) NULL,
  sss_number             VARCHAR(30) NULL,
  philhealth_number      VARCHAR(30) NULL,
  pagibig_number         VARCHAR(30) NULL,
  tin_number             VARCHAR(30) NULL,
  sss_coverage           BOOLEAN NOT NULL DEFAULT TRUE,
  philhealth_coverage    BOOLEAN NOT NULL DEFAULT TRUE,
  pagibig_coverage       BOOLEAN NOT NULL DEFAULT TRUE,
  gender                 VARCHAR(20) NULL,
  civil_status           VARCHAR(30) NULL,
  date_of_birth          DATE NULL,
  present_address        TEXT NULL,
  province               VARCHAR(100) NULL,
  contact_number         VARCHAR(20) NULL,
  email_address          VARCHAR(150) NULL,
  dependent_count        SMALLINT NULL,
  education_attainment   VARCHAR(150) NULL,
  education_course       VARCHAR(200) NULL,
  biometric_device_uid   VARCHAR(50) NULL,
  biometric_name         VARCHAR(100) NULL,
  biometric_sync_status  ENUM('not_enrolled','enrolled','sync_pending','sync_conflict','sync_failed') NULL,
  import_batch_id        VARCHAR(50) NULL,
  remarks                TEXT NULL,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by             INT NULL,
  updated_at             TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by             INT NULL,
  UNIQUE KEY uq_employee_number_company (employee_number, company_id),
  KEY idx_emp_company     (company_id),
  KEY idx_emp_subdept     (subdepartment_id),
  KEY idx_emp_status      (employee_status_id),
  KEY idx_emp_biometric   (biometric_device_uid),
  CONSTRAINT fk_emp_company     FOREIGN KEY (company_id)         REFERENCES tbl_company(company_id),
  CONSTRAINT fk_emp_department  FOREIGN KEY (department_id)      REFERENCES tbl_department(department_id),
  CONSTRAINT fk_emp_subdept     FOREIGN KEY (subdepartment_id)   REFERENCES tbl_subdepartment(subdepartment_id),
  CONSTRAINT fk_emp_emp_type    FOREIGN KEY (employment_type_id) REFERENCES tbl_employment_type(employment_type_id),
  CONSTRAINT fk_emp_status      FOREIGN KEY (employee_status_id) REFERENCES tbl_employee_status(employee_status_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_position (
  employee_position_id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id          INT NOT NULL,
  position_id          INT NOT NULL,
  is_primary           BOOLEAN NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  position_start_date  DATE NULL,
  position_end_date    DATE NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by           INT NULL,
  updated_at           TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by           INT NULL,
  CONSTRAINT fk_emppos_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_emppos_position FOREIGN KEY (position_id) REFERENCES tbl_position(position_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_emergency_contact (
  contact_id   INT AUTO_INCREMENT PRIMARY KEY,
  employee_id  INT NOT NULL,
  contact_name VARCHAR(150) NOT NULL,
  relationship VARCHAR(60) NULL,
  contact_number VARCHAR(20) NULL,
  is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by   INT NULL,
  updated_at   TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by   INT NULL,
  CONSTRAINT fk_emerg_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_employment_history (
  history_id         INT AUTO_INCREMENT PRIMARY KEY,
  employee_id        INT NOT NULL,
  employment_type_id INT NULL,
  employee_status_id INT NULL,
  position_id        INT NULL,
  start_date         DATE NOT NULL,
  end_date           DATE NULL,
  notes              TEXT NULL,
  recorded_by        INT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_emphistory_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_document (
  document_id   INT AUTO_INCREMENT PRIMARY KEY,
  employee_id   INT NOT NULL,
  document_type ENUM('employment_contract','government_id','educational_credential',
                     'performance_appraisal','disciplinary_record','clearance',
                     'medical_certificate','other') NOT NULL,
  file_path     VARCHAR(500) NOT NULL,
  file_name     VARCHAR(255) NOT NULL,
  description   VARCHAR(500) NULL,
  uploaded_by   INT NOT NULL,
  upload_date   DATE NOT NULL,
  notes         TEXT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_empdoc_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_position_rate (
  rate_id             INT AUTO_INCREMENT PRIMARY KEY,
  position_id         INT NOT NULL,
  company_id          INT NOT NULL,
  basic_daily         DECIMAL(10,2) NOT NULL,
  basic_monthly       DECIMAL(10,2) NOT NULL,
  salary_band_label   VARCHAR(30) NULL,
  effective_date      DATE NOT NULL,
  wage_order_reference VARCHAR(100) NULL,
  notes               TEXT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          INT NULL,
  updated_at          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by          INT NULL,
  CONSTRAINT fk_posrate_position FOREIGN KEY (position_id) REFERENCES tbl_position(position_id),
  CONSTRAINT fk_posrate_company  FOREIGN KEY (company_id)  REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_device_adapter (
  adapter_id    INT AUTO_INCREMENT PRIMARY KEY,
  adapter_name  VARCHAR(100) NOT NULL,
  adapter_key   VARCHAR(50) NOT NULL,
  protocol      ENUM('tcp_ip','http_rest','websocket','sdk','mobile') NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  notes         TEXT NULL,
  UNIQUE KEY uq_adapter_key (adapter_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_device (
  device_id        INT AUTO_INCREMENT PRIMARY KEY,
  company_id       INT NOT NULL,
  adapter_id       INT NOT NULL,
  device_code      VARCHAR(50) NOT NULL,
  device_name      VARCHAR(100) NOT NULL,
  device_type      VARCHAR(60) NOT NULL,
  location         VARCHAR(200) NOT NULL,
  ip_address       VARCHAR(45) NULL,
  serial_number    VARCHAR(60) NULL,
  firmware_version VARCHAR(30) NULL,
  sync_interval    INT NOT NULL DEFAULT 15,
  last_sync_at     TIMESTAMP NULL,
  last_sync_count  INT NULL,
  status           ENUM('online','offline','error','maintenance') NOT NULL DEFAULT 'online',
  last_error_code  VARCHAR(100) NULL,
  pairing_code     VARCHAR(20) NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_device_code (device_code),
  CONSTRAINT fk_device_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id),
  CONSTRAINT fk_device_adapter FOREIGN KEY (adapter_id) REFERENCES tbl_device_adapter(adapter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_employee_biometric_enrollment (
  enrollment_id   INT AUTO_INCREMENT PRIMARY KEY,
  employee_id     INT NOT NULL,
  device_id       INT NOT NULL,
  device_user_id  INT NOT NULL,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  enrolled_at     TIMESTAMP NULL,
  enrolled_by     INT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device_user (device_id, device_user_id),
  CONSTRAINT fk_bioenroll_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_bioenroll_device   FOREIGN KEY (device_id)   REFERENCES tbl_device(device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_biometric_enrollment_log (
  log_id              INT AUTO_INCREMENT PRIMARY KEY,
  employee_id         INT NOT NULL,
  device_id           INT NOT NULL,
  attempted_uid       INT NOT NULL,
  result              ENUM('success','conflict','failed') NOT NULL,
  conflict_employee_id INT NULL,
  error_message       VARCHAR(500) NULL,
  performed_by        INT NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_biolog_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_biolog_device   FOREIGN KEY (device_id)   REFERENCES tbl_device(device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_device_sync_log (
  sync_id         INT AUTO_INCREMENT PRIMARY KEY,
  device_id       INT NOT NULL,
  synced_at       TIMESTAMP NOT NULL,
  completed_at    TIMESTAMP NULL,
  record_count    INT NULL,
  resolved_count  INT NULL,
  unresolved_count INT NULL,
  status          ENUM('in_progress','success','partial','failed') NOT NULL,
  error_code      VARCHAR(100) NULL,
  triggered_by    ENUM('scheduled','manual') NOT NULL,
  triggered_by_user INT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_synclog_device FOREIGN KEY (device_id) REFERENCES tbl_device(device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_raw_device_logs (
  rdl_id                 INT AUTO_INCREMENT PRIMARY KEY,
  device_id              INT NOT NULL,
  sync_id                INT NULL,
  ac_no                  VARCHAR(20) NOT NULL,
  device_user_id         INT NOT NULL,
  employee_id            INT NULL,
  employee_name_raw      VARCHAR(100) NOT NULL,
  record_time            TIMESTAMP NOT NULL,
  state                  VARCHAR(20) NOT NULL,
  new_state              VARCHAR(50) NULL,
  exception              VARCHAR(50) NULL,
  operation              VARCHAR(50) NULL,
  verify_type            VARCHAR(30) NULL,
  ip                     VARCHAR(45) NULL,
  reconciliation_status  ENUM('unresolved','resolved','unresolvable') NOT NULL DEFAULT 'unresolved',
  reconciliation_note    VARCHAR(500) NULL,
  is_processed           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by             INT NULL,
  updated_at             TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by             INT NULL,
  CONSTRAINT fk_rdl_device   FOREIGN KEY (device_id)   REFERENCES tbl_device(device_id),
  CONSTRAINT fk_rdl_sync     FOREIGN KEY (sync_id)     REFERENCES tbl_device_sync_log(sync_id),
  CONSTRAINT fk_rdl_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_shift (
  shift_id          INT AUTO_INCREMENT PRIMARY KEY,
  shift_name        VARCHAR(60) NOT NULL,
  time_in           TIME NOT NULL,
  time_out          TIME NOT NULL,
  crosses_midnight  BOOLEAN NOT NULL DEFAULT FALSE,
  grace_period      INT NOT NULL DEFAULT 30,
  has_break         BOOLEAN NOT NULL DEFAULT TRUE,
  total_hours       DECIMAL(5,2) NULL,
  remarks           TEXT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        INT NULL,
  updated_at        TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by        INT NULL,
  UNIQUE KEY uq_shift_name (shift_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_shift_slot (
  slot_id          INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  slot_label       VARCHAR(60) NOT NULL,
  slot_order       TINYINT NOT NULL,
  is_reliever      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_slot_label_subdept (subdepartment_id, slot_label),
  UNIQUE KEY uq_slot_order_subdept (subdepartment_id, slot_order),
  CONSTRAINT fk_slot_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_shift_pool (
  pool_id          INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  shift_id         INT NOT NULL,
  shift_sequence_order INT NOT NULL,
  shift_display_label  VARCHAR(60) NULL,
  is_graveyard     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_pool_subdept_shift    (subdepartment_id, shift_id),
  UNIQUE KEY uq_pool_subdept_seqorder (subdepartment_id, shift_sequence_order),
  CONSTRAINT fk_pool_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id),
  CONSTRAINT fk_pool_shift   FOREIGN KEY (shift_id)         REFERENCES tbl_shift(shift_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_subdept_rest_day_config (
  config_id        INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  day_of_week      ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
  is_default_rest_day BOOLEAN NOT NULL DEFAULT FALSE,
  is_configurable  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_rest_subdept_day (subdepartment_id, day_of_week),
  CONSTRAINT fk_restday_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_cutoff_period (
  cutoff_id            INT AUTO_INCREMENT PRIMARY KEY,
  company_id           INT NOT NULL,
  cutoff_name          VARCHAR(60) NOT NULL,
  start_date           DATE NOT NULL,
  end_date             DATE NOT NULL,
  drafting_opens_at    TIMESTAMP NULL,
  lock_in_starts_at    TIMESTAMP NULL,
  is_locked            BOOLEAN NOT NULL DEFAULT FALSE,
  is_closed            BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at            TIMESTAMP NULL,
  closed_by            INT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by           INT NULL,
  CONSTRAINT fk_cutoff_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_cutoff_schedule_status (
  status_id        INT AUTO_INCREMENT PRIMARY KEY,
  cutoff_id        INT NOT NULL,
  subdepartment_id INT NOT NULL,
  schedule_state   ENUM('pending','open','closing','locked') NOT NULL DEFAULT 'pending',
  is_published     BOOLEAN NOT NULL DEFAULT FALSE,
  published_at     TIMESTAMP NULL,
  published_by     INT NULL,
  publish_source   ENUM('manual','auto_previous','force_hr') NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cutoff_status (cutoff_id, subdepartment_id),
  CONSTRAINT fk_cutoffstatus_cutoff  FOREIGN KEY (cutoff_id)        REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_cutoffstatus_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_schedule (
  schedule_id           INT AUTO_INCREMENT PRIMARY KEY,
  employee_id           INT NOT NULL,
  cutoff_id             INT NOT NULL,
  subdepartment_id      INT NOT NULL,
  slot_id               INT NULL,
  station_id            INT NULL,
  shift_id              INT NULL,
  continuation_shift_id INT NULL,
  date                  DATE NOT NULL,
  day_of_week           ENUM('MON','TUE','WED','THU','FRI','SAT','SUN') NOT NULL,
  start_date            DATE NULL,
  end_date              DATE NULL,
  is_rest_day           BOOLEAN NOT NULL DEFAULT FALSE,
  is_draft              BOOLEAN NOT NULL DEFAULT TRUE,
  is_reliever           BOOLEAN NOT NULL DEFAULT FALSE,
  relieving_for_employee_id INT NULL,
  shift_order           TINYINT NULL,
  sched_type            ENUM('regular','off','absent','on_leave','fvl','dod','regot',
                             'changeoff','holiday','absent_with_notice') NULL,
  is_ot                 BOOLEAN NOT NULL DEFAULT FALSE,
  night_diff            BOOLEAN NOT NULL DEFAULT FALSE,
  flex_time_in          TIME NULL,
  flex_time_out         TIME NULL,
  effective_date        DATE NOT NULL,
  hr_override           BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason       VARCHAR(500) NULL,
  remarks               TEXT NULL,
  is_holiday            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by            INT NULL,
  updated_at            TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by            INT NULL,
  UNIQUE KEY uq_schedule_emp_date (employee_id, date),
  KEY idx_schedule_cutoff (cutoff_id),
  KEY idx_schedule_subdept (subdepartment_id),
  CONSTRAINT fk_sched_employee     FOREIGN KEY (employee_id)             REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_sched_cutoff       FOREIGN KEY (cutoff_id)               REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_sched_subdept      FOREIGN KEY (subdepartment_id)        REFERENCES tbl_subdepartment(subdepartment_id),
  CONSTRAINT fk_sched_slot         FOREIGN KEY (slot_id)                 REFERENCES tbl_shift_slot(slot_id),
  CONSTRAINT fk_sched_station      FOREIGN KEY (station_id)              REFERENCES tbl_station(station_id),
  CONSTRAINT fk_sched_shift        FOREIGN KEY (shift_id)                REFERENCES tbl_shift(shift_id),
  CONSTRAINT fk_sched_continuation FOREIGN KEY (continuation_shift_id)  REFERENCES tbl_shift(shift_id),
  CONSTRAINT fk_sched_reliever_for FOREIGN KEY (relieving_for_employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_schedule_date_annotation (
  annotation_id   INT AUTO_INCREMENT PRIMARY KEY,
  schedule_id     INT NOT NULL,
  employee_id     INT NOT NULL,
  date            DATE NOT NULL,
  annotation_type ENUM('off','day_off','absent','absent_with_notice','on_leave','fvl',
                       'holiday_work','dod','regular_ot','change_off','admin_duty',
                       'reliever_active') NOT NULL,
  custom_label    VARCHAR(100) NULL,
  custom_time_in  TIME NULL,
  custom_time_out TIME NULL,
  activates_dod   BOOLEAN NOT NULL DEFAULT FALSE,
  activates_ot    BOOLEAN NOT NULL DEFAULT FALSE,
  notes           VARCHAR(500) NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      INT NULL,
  UNIQUE KEY uq_annotation_emp_date_type (employee_id, date, annotation_type),
  CONSTRAINT fk_annotation_schedule FOREIGN KEY (schedule_id) REFERENCES tbl_schedule(schedule_id),
  CONSTRAINT fk_annotation_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_schedule_exception (
  exception_id             INT AUTO_INCREMENT PRIMARY KEY,
  employee_id              INT NOT NULL,
  cutoff_id                INT NOT NULL,
  date                     DATE NOT NULL,
  original_shift_id        INT NULL,
  override_shift_id        INT NULL,
  relief_type              ENUM('shift_exchange','emergency_coverage','early_departure_coverage',
                                'event_coverage','reliever_activation') NULL,
  relief_start_time        TIME NULL,
  relief_end_time          TIME NULL,
  form_upload_id           INT NULL,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by               INT NULL,
  updated_at               TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by               INT NULL,
  UNIQUE KEY uq_exception_emp_date (employee_id, date),
  CONSTRAINT fk_exception_employee  FOREIGN KEY (employee_id)       REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_exception_cutoff    FOREIGN KEY (cutoff_id)         REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_exception_origshift FOREIGN KEY (original_shift_id) REFERENCES tbl_shift(shift_id),
  CONSTRAINT fk_exception_ovrdshift FOREIGN KEY (override_shift_id) REFERENCES tbl_shift(shift_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_schedule_event (
  event_id         INT AUTO_INCREMENT PRIMARY KEY,
  subdepartment_id INT NOT NULL,
  cutoff_id        INT NOT NULL,
  station_id       INT NULL,
  event_date       DATE NOT NULL,
  event_name       VARCHAR(200) NOT NULL,
  notes            TEXT NULL,
  external_ref     VARCHAR(200) NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  CONSTRAINT fk_event_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id),
  CONSTRAINT fk_event_cutoff  FOREIGN KEY (cutoff_id)        REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_event_station FOREIGN KEY (station_id)       REFERENCES tbl_station(station_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_timekeeping (
  timekeeping_id      INT AUTO_INCREMENT PRIMARY KEY,
  employee_id         INT NOT NULL,
  schedule_id         INT NULL,
  cutoff_id           INT NOT NULL,
  date                DATE NOT NULL,
  day_of_week         VARCHAR(10) NULL,
  segment_order       TINYINT NOT NULL DEFAULT 1,
  is_continuation     BOOLEAN NOT NULL DEFAULT FALSE,
  time_in             TIME NULL,
  time_out            TIME NULL,
  scheduled_time_in   TIME NULL,
  scheduled_time_out  TIME NULL,
  segment_hours       DECIMAL(5,2) NULL,
  gap_minutes_before_segment SMALLINT NULL,
  total_hours_day     DECIMAL(5,2) NULL,
  is_override         BOOLEAN NOT NULL DEFAULT FALSE,
  day_scenario        ENUM('regular','rest_day','regular_holiday','special_holiday',
                           'regular_holiday_rest_day','special_holiday_rest_day') NULL,
  ot_multiplier_snapshot  DECIMAL(4,2) NULL,
  nd_rate_snapshot        DECIMAL(4,2) NULL,
  is_late             BOOLEAN NOT NULL DEFAULT FALSE,
  late_minutes        SMALLINT NULL,
  is_absent           BOOLEAN NOT NULL DEFAULT FALSE,
  ot_approval_status  ENUM('not_required','pending_form','form_approved','flagged_no_form') NULL,
  anomaly_flag        BOOLEAN NOT NULL DEFAULT FALSE,
  anomaly_notes       TEXT NULL,
  supervisor_verified BOOLEAN NOT NULL DEFAULT FALSE,
  break_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  ot_form_required    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          INT NULL,
  updated_at          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by          INT NULL,
  UNIQUE KEY uq_tk_employee_date_segment (employee_id, date, segment_order),
  KEY idx_tk_cutoff   (cutoff_id),
  KEY idx_tk_employee (employee_id),
  CONSTRAINT fk_tk_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_tk_schedule FOREIGN KEY (schedule_id) REFERENCES tbl_schedule(schedule_id),
  CONSTRAINT fk_tk_cutoff   FOREIGN KEY (cutoff_id)   REFERENCES tbl_cutoff_period(cutoff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_deduction (
  deduction_id     INT AUTO_INCREMENT PRIMARY KEY,
  timekeeping_id   INT NOT NULL,
  cutoff_id        INT NOT NULL,
  date             DATE NOT NULL,
  late             DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  undertime        DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  halfday          DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  is_absent        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_deduction_tk (timekeeping_id),
  CONSTRAINT fk_deduction_tk     FOREIGN KEY (timekeeping_id) REFERENCES tbl_timekeeping(timekeeping_id),
  CONSTRAINT fk_deduction_cutoff FOREIGN KEY (cutoff_id)      REFERENCES tbl_cutoff_period(cutoff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_additional (
  additional_id    INT AUTO_INCREMENT PRIMARY KEY,
  timekeeping_id   INT NOT NULL,
  cutoff_id        INT NOT NULL,
  date             DATE NOT NULL,
  early_ot         DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  late_ot          DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  night_diff       DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  ot_multiplier_snapshot DECIMAL(4,2) NULL,
  nd_rate_snapshot       DECIMAL(4,2) NULL,
  ot_approval_status ENUM('not_required','pending_form','form_approved','flagged_no_form') NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_additional_tk (timekeeping_id),
  CONSTRAINT fk_additional_tk     FOREIGN KEY (timekeeping_id) REFERENCES tbl_timekeeping(timekeeping_id),
  CONSTRAINT fk_additional_cutoff FOREIGN KEY (cutoff_id)      REFERENCES tbl_cutoff_period(cutoff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_dod (
  dod_id           INT AUTO_INCREMENT PRIMARY KEY,
  timekeeping_id   INT NOT NULL,
  cutoff_id        INT NOT NULL,
  date             DATE NOT NULL,
  dod_ot           DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  dod_nd           DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  dod_multiplier   DECIMAL(4,2) NOT NULL DEFAULT 1.30,
  holiday_type     ENUM('none','regular_holiday','special_holiday') NOT NULL DEFAULT 'none',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_dod_tk (timekeeping_id),
  CONSTRAINT fk_dod_tk     FOREIGN KEY (timekeeping_id) REFERENCES tbl_timekeeping(timekeeping_id),
  CONSTRAINT fk_dod_cutoff FOREIGN KEY (cutoff_id)      REFERENCES tbl_cutoff_period(cutoff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_time_override (
  override_id    INT AUTO_INCREMENT PRIMARY KEY,
  timekeeping_id INT NOT NULL,
  override_type  ENUM('missed_punch_in','missed_punch_out','incorrect_punch_direction',
                      'wrong_datetime','duplicate_punch','wrong_device',
                      'device_offline_absence','retroactive_schedule_correction',
                      'attendance_status_correction') NOT NULL,
  requested_by   INT NOT NULL,
  old_time_in    TIME NULL,
  new_time_in    TIME NULL,
  old_time_out   TIME NULL,
  new_time_out   TIME NULL,
  new_schedule_id INT NULL,
  reason         VARCHAR(500) NOT NULL,
  status         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by    INT NULL,
  reviewed_at    TIMESTAMP NULL,
  review_note    VARCHAR(500) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by     INT NULL,
  updated_at     TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by     INT NULL,
  CONSTRAINT fk_override_tk       FOREIGN KEY (timekeeping_id)  REFERENCES tbl_timekeeping(timekeeping_id),
  CONSTRAINT fk_override_newsched FOREIGN KEY (new_schedule_id) REFERENCES tbl_schedule(schedule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_holiday (
  holiday_id      INT AUTO_INCREMENT PRIMARY KEY,
  company_id      INT NULL,
  holiday_date    DATE NOT NULL,
  holiday_name    VARCHAR(150) NOT NULL,
  holiday_type    ENUM('regular','special_non_working','special_working') NOT NULL,
  is_proclamation BOOLEAN NOT NULL DEFAULT FALSE,
  year            INT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      INT NULL,
  updated_at      TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by      INT NULL,
  CONSTRAINT fk_holiday_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave_type (
  leave_type_id       INT AUTO_INCREMENT PRIMARY KEY,
  leave_type          VARCHAR(80) NOT NULL,
  is_statutory        BOOLEAN NOT NULL DEFAULT FALSE,
  is_cash_convertible BOOLEAN NOT NULL DEFAULT FALSE,
  sss_reimbursable    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          INT NULL,
  updated_at          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by          INT NULL,
  UNIQUE KEY uq_leave_type (leave_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave_config (
  leave_config_id    INT AUTO_INCREMENT PRIMARY KEY,
  employment_type_id INT NOT NULL,
  leave_type_id      INT NOT NULL,
  annual_days        DECIMAL(5,2) NOT NULL,
  effective_date     DATE NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  updated_at         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by         INT NULL,
  UNIQUE KEY uq_leave_config_emptype_leavetype (employment_type_id, leave_type_id),
  CONSTRAINT fk_leaveconfig_emptype   FOREIGN KEY (employment_type_id) REFERENCES tbl_employment_type(employment_type_id),
  CONSTRAINT fk_leaveconfig_leavetype FOREIGN KEY (leave_type_id)      REFERENCES tbl_leave_type(leave_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave_tier_config (
  tier_id       INT AUTO_INCREMENT PRIMARY KEY,
  leave_type_id INT NOT NULL,
  tier_number   TINYINT NOT NULL,
  min_years     DECIMAL(4,2) NOT NULL,
  max_years     DECIMAL(4,2) NULL,
  annual_days   DECIMAL(5,2) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by    INT NULL,
  CONSTRAINT fk_leavetier_leavetype FOREIGN KEY (leave_type_id) REFERENCES tbl_leave_type(leave_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave_balance (
  balance_id         INT AUTO_INCREMENT PRIMARY KEY,
  employee_id        INT NOT NULL,
  leave_type_id      INT NOT NULL,
  year               INT NOT NULL,
  total_credits      DECIMAL(5,2) NOT NULL,
  used_credits       DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  remaining_credits  DECIMAL(5,2) NOT NULL,
  carryover_credits  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  cash_payout_amount DECIMAL(10,2) NULL,
  payout_date        DATE NULL,
  allocation_source  ENUM('employment_type','tenure','position','manual') NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  updated_at         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by         INT NULL,
  UNIQUE KEY uq_leave_balance (employee_id, leave_type_id, year),
  CONSTRAINT fk_leavebal_employee  FOREIGN KEY (employee_id)   REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_leavebal_leavetype FOREIGN KEY (leave_type_id) REFERENCES tbl_leave_type(leave_type_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave (
  leave_id              INT AUTO_INCREMENT PRIMARY KEY,
  employee_id           INT NOT NULL,
  cutoff_id             INT NULL,
  leave_type_id         INT NOT NULL,
  leave_balance_id      INT NULL,
  start_date            DATE NOT NULL,
  end_date              DATE NOT NULL,
  with_pay              BOOLEAN NOT NULL DEFAULT TRUE,
  ut_hours              DECIMAL(5,2) NULL,
  address_on_leave      VARCHAR(500) NULL,
  reason                VARCHAR(500) NULL,
  leave_initiation_type ENUM('employee_filed','hr_initiated','forced_leave') NOT NULL DEFAULT 'employee_filed',
  batch_reference       VARCHAR(100) NULL,
  status                ENUM('pending','endorsed','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  endorsed_by           INT NULL,
  approved_by           INT NULL,
  noted_by              VARCHAR(100) NULL,
  balance_at_filing_vl  DECIMAL(5,2) NULL,
  balance_at_filing_sl  DECIMAL(5,2) NULL,
  form_upload_id        INT NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by            INT NULL,
  updated_at            TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by            INT NULL,
  CONSTRAINT fk_leave_employee  FOREIGN KEY (employee_id)     REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_leave_cutoff    FOREIGN KEY (cutoff_id)       REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_leave_leavetype FOREIGN KEY (leave_type_id)   REFERENCES tbl_leave_type(leave_type_id),
  CONSTRAINT fk_leave_balance   FOREIGN KEY (leave_balance_id) REFERENCES tbl_leave_balance(balance_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_user_account (
  user_acc_id              INT AUTO_INCREMENT PRIMARY KEY,
  employee_id              INT NULL,
  email                    VARCHAR(150) NOT NULL,
  password                 VARCHAR(255) NOT NULL,
  role                     ENUM('super_admin','hr','coord','it','admin') NOT NULL,
  is_active                BOOLEAN NOT NULL DEFAULT TRUE,
  notification_delivery    ENUM('in_app','email','both') NOT NULL DEFAULT 'in_app',
  failed_login_count       INT NOT NULL DEFAULT 0,
  last_failed_login_at     TIMESTAMP NULL,
  must_change_password     BOOLEAN NOT NULL DEFAULT TRUE,
  is_bootstrap             BOOLEAN NOT NULL DEFAULT FALSE,
  can_access_system_config BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by               INT NULL,
  updated_at               TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by               INT NULL,
  UNIQUE KEY uq_email (email),
  UNIQUE KEY uq_employee_account (employee_id),
  CONSTRAINT fk_useracc_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_user_scope (
  scope_id         INT AUTO_INCREMENT PRIMARY KEY,
  user_acc_id      INT NOT NULL,
  subdepartment_id INT NOT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_user_scope (user_acc_id, subdepartment_id),
  CONSTRAINT fk_scope_user    FOREIGN KEY (user_acc_id)      REFERENCES tbl_user_account(user_acc_id),
  CONSTRAINT fk_scope_subdept FOREIGN KEY (subdepartment_id) REFERENCES tbl_subdepartment(subdepartment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_module_access (
  module_access_id INT AUTO_INCREMENT PRIMARY KEY,
  user_acc_id      INT NOT NULL,
  module_key       VARCHAR(80) NOT NULL,
  is_granted       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by       INT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by       INT NULL,
  UNIQUE KEY uq_module_access (user_acc_id, module_key),
  CONSTRAINT fk_moduleaccess_user FOREIGN KEY (user_acc_id) REFERENCES tbl_user_account(user_acc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_session_log (
  session_id  INT AUTO_INCREMENT PRIMARY KEY,
  user_acc_id INT NOT NULL,
  login_at    TIMESTAMP NOT NULL,
  logout_at   TIMESTAMP NULL,
  ip_address  VARCHAR(45) NULL,
  user_agent  VARCHAR(500) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_session_user FOREIGN KEY (user_acc_id) REFERENCES tbl_user_account(user_acc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_form_upload (
  form_upload_id      INT AUTO_INCREMENT PRIMARY KEY,
  employee_id         INT NOT NULL,
  uploaded_by         INT NOT NULL,
  cutoff_id           INT NULL,
  form_type           ENUM('OT_Request','Vacation_Leave','Sick_Leave','Emergency_Leave',
                           'Undertime','Shift_Schedule_Exchange','Forced_Vacation_Leave','Other') NOT NULL,
  exchange_partner_id INT NULL,
  exchange_date       DATE NULL,
  reference_start     DATE NOT NULL,
  reference_end       DATE NULL,
  ot_time_start       TIME NULL,
  ot_time_end         TIME NULL,
  ot_hours_requested  DECIMAL(4,2) NULL,
  file_path           VARCHAR(500) NULL,
  file_name           VARCHAR(255) NULL,
  reason              VARCHAR(500) NOT NULL,
  agreed_by           VARCHAR(100) NULL,
  noted_by            VARCHAR(100) NULL,
  endorsement_status  ENUM('endorsed','returned') NOT NULL,
  coordinator_note    VARCHAR(500) NULL,
  hr_status           ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  reviewed_by         INT NULL,
  reviewed_at         TIMESTAMP NULL,
  hr_note             VARCHAR(500) NULL,
  cascade_status      ENUM('pending','completed','failed') NULL,
  cascaded_at         TIMESTAMP NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by          INT NULL,
  updated_at          TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by          INT NULL,
  CONSTRAINT fk_formup_employee FOREIGN KEY (employee_id)         REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_formup_partner  FOREIGN KEY (exchange_partner_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_formup_cutoff   FOREIGN KEY (cutoff_id)           REFERENCES tbl_cutoff_period(cutoff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_shift_swap (
  swap_id         INT AUTO_INCREMENT PRIMARY KEY,
  emp1_id         INT NOT NULL,
  emp2_id         INT NOT NULL,
  swap_date_start DATE NOT NULL,
  swap_date_end   DATE NOT NULL,
  emp1_time_in    TIME NULL,
  emp1_time_out   TIME NULL,
  emp2_time_in    TIME NULL,
  emp2_time_out   TIME NULL,
  reason          TEXT NULL,
  status          ENUM('pending','approved','denied') NOT NULL DEFAULT 'pending',
  approved_by     INT NULL,
  form_upload_id  INT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by      INT NULL,
  updated_at      TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by      INT NULL,
  CONSTRAINT fk_swap_emp1   FOREIGN KEY (emp1_id)        REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_swap_emp2   FOREIGN KEY (emp2_id)        REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_swap_formup FOREIGN KEY (form_upload_id) REFERENCES tbl_form_upload(form_upload_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_service_charge (
  charge_id         INT AUTO_INCREMENT PRIMARY KEY,
  cutoff_id         INT NOT NULL,
  company_id        INT NOT NULL,
  collection_amount DECIMAL(12,2) NOT NULL,
  distribution_date DATE NULL,
  status            ENUM('pending','distributed','exported') NOT NULL DEFAULT 'pending',
  notes             TEXT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        INT NULL,
  updated_at        TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by        INT NULL,
  CONSTRAINT fk_svccharge_cutoff  FOREIGN KEY (cutoff_id)  REFERENCES tbl_cutoff_period(cutoff_id),
  CONSTRAINT fk_svccharge_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_service_charge_distribution (
  distribution_id INT AUTO_INCREMENT PRIMARY KEY,
  charge_id       INT NOT NULL,
  employee_id     INT NOT NULL,
  hours_worked    DECIMAL(6,2) NOT NULL,
  share_amount    DECIMAL(10,2) NOT NULL,
  is_exported     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_svcdist_charge   FOREIGN KEY (charge_id)  REFERENCES tbl_service_charge(charge_id),
  CONSTRAINT fk_svcdist_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_13th_month_pay (
  pay_id                 INT AUTO_INCREMENT PRIMARY KEY,
  employee_id            INT NOT NULL,
  year                   INT NOT NULL,
  total_basic_salary_ytd DECIMAL(12,2) NOT NULL,
  computed_amount        DECIMAL(12,2) NOT NULL,
  status                 ENUM('computed','reviewed','released') NOT NULL DEFAULT 'computed',
  release_date           DATE NULL,
  is_exported            BOOLEAN NOT NULL DEFAULT FALSE,
  notes                  TEXT NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by             INT NULL,
  updated_at             TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by             INT NULL,
  UNIQUE KEY uq_13th_emp_year (employee_id, year),
  CONSTRAINT fk_13th_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_external_worker (
  external_worker_id INT AUTO_INCREMENT PRIMARY KEY,
  company_id         INT NOT NULL,
  full_name          VARCHAR(200) NOT NULL,
  agency_name        VARCHAR(200) NULL,
  worker_type        ENUM('guard','contractor','ojtintern','other') NOT NULL,
  station_id         INT NULL,
  contact_number     VARCHAR(20) NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  CONSTRAINT fk_extworker_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id),
  CONSTRAINT fk_extworker_station FOREIGN KEY (station_id) REFERENCES tbl_station(station_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_external_attendance (
  ext_attendance_id  INT AUTO_INCREMENT PRIMARY KEY,
  external_worker_id INT NOT NULL,
  date               DATE NOT NULL,
  time_in            TIME NULL,
  time_out           TIME NULL,
  entry_source       ENUM('biometric','manual','import') NOT NULL DEFAULT 'manual',
  entered_by         INT NULL,
  notes              TEXT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  CONSTRAINT fk_extatt_worker FOREIGN KEY (external_worker_id) REFERENCES tbl_external_worker(external_worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_external_guard_schedule (
  guard_schedule_id  INT AUTO_INCREMENT PRIMARY KEY,
  external_worker_id INT NOT NULL,
  station_id         INT NULL,
  date               DATE NOT NULL,
  time_in            TIME NULL,
  time_out           TIME NULL,
  notes              TEXT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by         INT NULL,
  CONSTRAINT fk_guardsch_worker  FOREIGN KEY (external_worker_id) REFERENCES tbl_external_worker(external_worker_id),
  CONSTRAINT fk_guardsch_station FOREIGN KEY (station_id)         REFERENCES tbl_station(station_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_computation_rules (
  config_id                          INT PRIMARY KEY DEFAULT 1,
  grace_period_minutes               INT NOT NULL DEFAULT 30,
  early_ot_threshold_minutes         INT NOT NULL DEFAULT 30,
  late_ot_threshold_minutes          INT NOT NULL DEFAULT 30,
  missed_punch_detection_buffer_minutes INT NOT NULL DEFAULT 60,
  duplicate_punch_window_seconds     INT NOT NULL DEFAULT 60,
  min_rest_hours_between_shifts      DECIMAL(4,2) NOT NULL DEFAULT 8.00,
  early_ot_max_hours                 DECIMAL(4,2) NOT NULL DEFAULT 4.00,
  late_ot_max_hours                  DECIMAL(4,2) NOT NULL DEFAULT 4.00,
  nd_window_start                    TIME NOT NULL DEFAULT '22:00:00',
  nd_window_end                      TIME NOT NULL DEFAULT '06:00:00',
  standard_shift_hours               DECIMAL(4,2) NOT NULL DEFAULT 8.00,
  break_deduct_hours                 DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  break_deduct_threshold_hours       DECIMAL(4,2) NOT NULL DEFAULT 8.00,
  break_deduction_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  awol_threshold_days                INT NOT NULL DEFAULT 3,
  awol_auto_flag_enabled             BOOLEAN NOT NULL DEFAULT TRUE,
  probation_regularization_reminder_days INT NOT NULL DEFAULT 14,
  auto_regularize                    BOOLEAN NOT NULL DEFAULT TRUE,
  training_duration_days             INT NOT NULL DEFAULT 16,
  ot_form_required                   BOOLEAN NOT NULL DEFAULT FALSE,
  eot_multiplier                     DECIMAL(5,4) NOT NULL DEFAULT 1.2500,
  lot_multiplier                     DECIMAL(5,4) NOT NULL DEFAULT 1.3750,
  nd_rate                            DECIMAL(5,4) NOT NULL DEFAULT 0.1000,
  ot_multiplier                      DECIMAL(5,4) NOT NULL DEFAULT 1.2500,
  shod_eot_multiplier                DECIMAL(5,4) NOT NULL DEFAULT 1.6900,
  shod_lot_multiplier                DECIMAL(5,4) NOT NULL DEFAULT 1.8590,
  shod_nd_rate                       DECIMAL(5,4) NOT NULL DEFAULT 0.1300,
  shod_pay_rate                      DECIMAL(5,4) NOT NULL DEFAULT 0.3000,
  rhod_eot_multiplier                DECIMAL(5,4) NOT NULL DEFAULT 2.6000,
  rhod_lot_multiplier                DECIMAL(5,4) NOT NULL DEFAULT 2.8600,
  rhod_nd_rate                       DECIMAL(5,4) NOT NULL DEFAULT 0.2000,
  rhod_pay_rate                      DECIMAL(5,4) NOT NULL DEFAULT 1.0000,
  dod_pay_rate                       DECIMAL(5,4) NOT NULL DEFAULT 0.1300,
  dod_multiplier                     DECIMAL(5,4) NOT NULL DEFAULT 1.3000,
  dod_eot_multiplier                 DECIMAL(5,4) NOT NULL DEFAULT 1.6900,
  dod_lot_multiplier                 DECIMAL(5,4) NOT NULL DEFAULT 1.8590,
  dod_nd_rate                        DECIMAL(5,4) NOT NULL DEFAULT 0.1300,
  rhod_dod_eot_multiplier            DECIMAL(5,4) NOT NULL DEFAULT 3.3800,
  rhod_dod_lot_multiplier            DECIMAL(5,4) NOT NULL DEFAULT 3.7180,
  rhod_dod_nd_rate                   DECIMAL(5,4) NOT NULL DEFAULT 0.2600,
  rhod_dod_pay_rate                  DECIMAL(5,4) NOT NULL DEFAULT 2.6000,
  shod_dod_eot_multiplier            DECIMAL(5,4) NOT NULL DEFAULT 1.9500,
  shod_dod_lot_multiplier            DECIMAL(5,4) NOT NULL DEFAULT 2.1500,
  shod_dod_nd_rate                   DECIMAL(5,4) NOT NULL DEFAULT 0.1500,
  shod_dod_pay_rate                  DECIMAL(5,4) NOT NULL DEFAULT 1.5000,
  phic_rate                          DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
  biometric_matching_strategy        ENUM('uid_only','uid_then_name','uid_then_name_then_employee_number')
                                     NOT NULL DEFAULT 'uid_then_name',
  updated_at                         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by                         INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_leave_config_global (
  config_id                    INT PRIMARY KEY DEFAULT 1,
  leave_allocation_mode        ENUM('employment_type','tenure','position','combined') NOT NULL DEFAULT 'tenure',
  leave_rule_priority          ENUM('highest_value','employment_type_first','tenure_first','position_first')
                               NOT NULL DEFAULT 'highest_value',
  vl_sl_combined               BOOLEAN NOT NULL DEFAULT FALSE,
  leave_cap_days               DECIMAL(5,2) NULL,
  carryover_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
  carryover_max_days           DECIMAL(5,2) NULL,
  sl_cash_convertible          BOOLEAN NOT NULL DEFAULT TRUE,
  vl_force_consume             BOOLEAN NOT NULL DEFAULT TRUE,
  schedule_publish_reminder_days INT NULL DEFAULT 2,
  year_rollover_reminder_days  INT NULL DEFAULT 30,
  updated_at                   TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by                   INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_system_config (
  config_id                          INT PRIMARY KEY DEFAULT 1,
  session_expiry_hours               INT NOT NULL DEFAULT 24,
  session_inactivity_timeout_minutes INT NOT NULL DEFAULT 30,
  max_failed_logins                  INT NOT NULL DEFAULT 5,
  account_lockout_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
  lockout_duration_minutes           INT NOT NULL DEFAULT 15,
  audit_log_retention_days           INT NOT NULL DEFAULT 90,
  password_min_length                INT NOT NULL DEFAULT 8,
  password_require_uppercase         BOOLEAN NOT NULL DEFAULT TRUE,
  password_require_number            BOOLEAN NOT NULL DEFAULT TRUE,
  password_require_special           BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at                         TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by                         INT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_notification_config (
  config_id            INT AUTO_INCREMENT PRIMARY KEY,
  trigger_type         VARCHAR(80) NOT NULL,
  priority_tier        ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
  is_enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  notify_hr            BOOLEAN NOT NULL DEFAULT FALSE,
  notify_coordinator   BOOLEAN NOT NULL DEFAULT FALSE,
  notify_it            BOOLEAN NOT NULL DEFAULT FALSE,
  notify_admin         BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_hr          ENUM('in_app','email','both') NULL,
  delivery_coordinator ENUM('in_app','email','both') NULL,
  delivery_it          ENUM('in_app','email','both') NULL,
  delivery_admin       ENUM('in_app','email','both') NULL,
  updated_at           TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by           INT NULL,
  UNIQUE KEY uq_trigger_type (trigger_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_notification (
  notification_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  recipient_id         INT NOT NULL,
  trigger_type         VARCHAR(80) NOT NULL,
  trigger_source_id    INT NULL,
  trigger_source_table VARCHAR(60) NULL,
  message              VARCHAR(500) NOT NULL,
  is_read              BOOLEAN NOT NULL DEFAULT FALSE,
  read_at              TIMESTAMP NULL,
  expires_at           TIMESTAMP NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_recipient FOREIGN KEY (recipient_id) REFERENCES tbl_user_account(user_acc_id),
  CONSTRAINT fk_notif_config    FOREIGN KEY (trigger_type) REFERENCES tbl_notification_config(trigger_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_user_preference (
  preference_id    INT AUTO_INCREMENT PRIMARY KEY,
  user_acc_id      INT NOT NULL,
  preference_key   VARCHAR(80) NOT NULL,
  preference_value VARCHAR(200) NOT NULL,
  updated_at       TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_pref (user_acc_id, preference_key),
  CONSTRAINT fk_pref_user FOREIGN KEY (user_acc_id) REFERENCES tbl_user_account(user_acc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_import_column_map (
  map_id                        INT AUTO_INCREMENT PRIMARY KEY,
  company_id                    INT NULL,
  profile_name                  VARCHAR(150) NOT NULL,
  created_by                    INT NOT NULL,
  field_last_name               VARCHAR(100) NULL,
  field_first_name              VARCHAR(100) NULL,
  field_middle_name             VARCHAR(100) NULL,
  field_middle_initial          VARCHAR(100) NULL,
  field_name_suffix             VARCHAR(100) NULL,
  field_employee_number         VARCHAR(100) NULL,
  field_company                 VARCHAR(100) NULL,
  field_department              VARCHAR(100) NULL,
  field_subdepartment           VARCHAR(100) NULL,
  field_position                VARCHAR(100) NULL,
  field_employment_type         VARCHAR(100) NULL,
  field_date_hired              VARCHAR(100) NULL,
  field_training_start          VARCHAR(100) NULL,
  field_probationary_start      VARCHAR(100) NULL,
  field_date_regularized        VARCHAR(100) NULL,
  field_basic_salary            VARCHAR(100) NULL,
  field_allowance               VARCHAR(100) NULL,
  field_payroll_type            VARCHAR(100) NULL,
  field_payroll_account         VARCHAR(100) NULL,
  field_gender                  VARCHAR(100) NULL,
  field_civil_status            VARCHAR(100) NULL,
  field_date_of_birth           VARCHAR(100) NULL,
  field_address                 VARCHAR(100) NULL,
  field_province                VARCHAR(100) NULL,
  field_contact_number          VARCHAR(100) NULL,
  field_email_address           VARCHAR(100) NULL,
  field_education_attainment    VARCHAR(100) NULL,
  field_education_course        VARCHAR(100) NULL,
  field_sss                     VARCHAR(100) NULL,
  field_philhealth              VARCHAR(100) NULL,
  field_pagibig                 VARCHAR(100) NULL,
  field_tin                     VARCHAR(100) NULL,
  field_dependent_count         VARCHAR(100) NULL,
  field_emergency_contact_name  VARCHAR(100) NULL,
  field_emergency_contact_rel   VARCHAR(100) NULL,
  field_emergency_contact_phone VARCHAR(100) NULL,
  field_biometric_name          VARCHAR(100) NULL,
  field_remarks                 VARCHAR(100) NULL,
  is_default                    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                    TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by                    INT NULL,
  CONSTRAINT fk_importmap_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_audit_log (
  audit_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  action_type          VARCHAR(100) NOT NULL,
  actor_id             INT NOT NULL,
  actor_role           VARCHAR(30) NOT NULL,
  affected_employee_id INT NULL,
  target_table         VARCHAR(60) NULL,
  target_record_id     INT NULL,
  field_changed        VARCHAR(100) NULL,
  old_value            TEXT NULL,
  new_value            TEXT NULL,
  reason               VARCHAR(500) NULL,
  ip_address           VARCHAR(45) NULL,
  user_agent           VARCHAR(500) NULL,
  status               ENUM('success','failure','pending') NOT NULL DEFAULT 'success',
  error_message        TEXT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tbl_dole_notification (
  notification_id   INT AUTO_INCREMENT PRIMARY KEY,
  company_id        INT NOT NULL,
  arrangement_type  ENUM('broken_time','forced_leave','compressed_workweek','reduced_hours','rotation') NOT NULL,
  date_filed        DATE NULL,
  date_acknowledged DATE NULL,
  reference_number  VARCHAR(100) NULL,
  status            ENUM('pending','filed','acknowledged') NOT NULL DEFAULT 'pending',
  notes             TEXT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by        INT NULL,
  updated_at        TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  updated_by        INT NULL,
  CONSTRAINT fk_dolenot_company FOREIGN KEY (company_id) REFERENCES tbl_company(company_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
```

---

## 10. EXISTING CODE (From Provided Files)

### 10.1 attendance-utils.js (Current biometric punch resolver)
```javascript
// Key logic: first punch = IN, next punch = OUT, alternating
// 14-hour gap forces reset to IN
// Overnight shift detected via yesterday's schedule is_overnight flag
// 5-minute double-tap buffer (duplicate suppression)
const MAX_SHIFT_GAP_HOURS = 14;
```

**Known gaps in current implementation vs schema:**
- Does not handle split/continuation shifts (second punch pair)
- Does not compare against scheduled time to classify Early OT vs early arrival
- Does not detect anomalies or ghost punches
- Uses `device_user_id` only; does not implement three-tier reconciliation
- `tbl_schedule` in old schema uses `device_user_id` as FK — new schema uses `employee_id` + `tbl_employee_biometric_enrollment` as the join path

### 10.2 zk-sync.js (Current ZKTeco bridge)
```javascript
// Connects to ZKTeco UF100 via node-zklib TCP
// DEVICE_IP and DEVICE_PORT from environment variables
// Three main functions:
//   syncUsersFromDevice() — pulls users from device → tbl_employee (INSERT/UPDATE)
//   syncAttendanceFromDevice() — pulls punches → tbl_device_logs (with cursor/stamp)
//   pushUserToDevice() — creates user on device from DB; UID assigned from MAX(device_uid)+1
// Cursor stored in tbl_device_sync (serial_number → last_stamp)
// SYSTEM_START_DATE = 2026-04-13 (ignores older punches)
```

**Known issues in current implementation:**
- `tbl_employee` in old schema ≠ `tbl_employees` in new schema (renamed, restructured)
- `device_uid` (ZK internal sequence) and `device_user_id` (employee's UID on device) conflated — new schema separates them in `tbl_employee_biometric_enrollment`
- No conflict detection before push (new schema adds `tbl_biometric_enrollment_log`)
- `pushUserToDevice` uses `MAX(device_uid)+1` from DB — ZK device may have a different internal counter. Risk of collision with devices not yet synced.

---

## 11. SEEDED DATA (Required at Migration)

### Employment Types
Full-time, Part-time, Seasonal, Project-based, Fixed-term, Casual, Contractual, Intern/OJT, Trainee

### Employee Statuses
Active, Probationary, On Training, On Leave, Suspended, AWOL, Resigned, Terminated, Retired, Separated

### Leave Types (Minerva active: first 5)
1. Vacation Leave — `is_cash_convertible=FALSE`, `is_statutory=TRUE`
2. Sick Leave — `is_cash_convertible=TRUE`, `is_statutory=TRUE`
3. Emergency Leave
4. Undertime
5. Forced Vacation Leave (FVL) — `leave_initiation_type=forced_leave`
6. Maternity Leave — `is_statutory=TRUE`, `sss_reimbursable=TRUE` [JULIE]
7. Paternity Leave — `is_statutory=TRUE` [JULIE]
8. Solo Parent Leave — `is_statutory=TRUE` [JULIE]
9. VAWC Leave — `is_statutory=TRUE` [JULIE]
10. Special Women's Leave — `is_statutory=TRUE` [JULIE]
11. Adoption Leave — `is_statutory=TRUE` [JULIE]
12. Bereavement Leave [JULIE]
13. Other

### Leave Tiers (Minerva — tenure-based)
| Tier | Min Years | Max Years | VL Days | SL Days |
|---|---|---|---|---|
| 1 | 0 | 1 | 5 | 5 |
| 2 | 1 | 2 | 6 | 6 |
| 3 | 2 | NULL | 7 | 7 |

### Device Adapter (Minerva)
| adapter_key | adapter_name | protocol |
|---|---|---|
| zkteco | ZKTeco SDK | tcp_ip |

### Notification Triggers with Priority Tiers
**CRITICAL:** DEVICE_OFFLINE, DEVICE_SYNC_FAILED, OVERRIDE_REQUESTED, AWOL_FLAGGED, CUTOFF_CLOSING  
**HIGH:** OVERRIDE_APPROVED, OVERRIDE_REJECTED, LEAVE_APPROVED, LEAVE_REJECTED, LEAVE_CANCELLED, LEAVE_ENDORSED, FORM_UPLOADED, FORM_RETURNED, SCHEDULE_LOCKED, PROBATION_APPROACHING_REGULARIZATION, YEAR_ROLLOVER_COMPLETED, YEAR_ROLLOVER_FAILED  
**MEDIUM:** CUTOFF_APPROACHING, DRAFTING_OPENED, SCHEDULE_AUTO_APPLIED, OT_FLAGGED_NO_FORM, BIOMETRIC_NOT_ENROLLED, EMPLOYEE_CREATED, DEVICE_RECONCILIATION_FAILED  
**LOW:** CUTOFF_CLOSED, LEAVE_BALANCE_LOW, WAGE_ORDER_REMINDER, REPORT_EXPORTED, SETTINGS_CHANGE, MISSED_PUNCH_DETECTED

### Computation Rules Row (config_id = 1, insert once)
All defaults as specified in `tbl_computation_rules` DDL above. Key values from client's rate table:
- `basic_daily = 695.00` (NCR minimum wage 2026, Wage Order NCR-26) — move to `tbl_company` eventually
- `phic_rate = 0.05`
- `dod_multiplier = 1.30`
- `rhod_pay_rate = 1.00` (no additional premium on base for rest day work on regular holiday)

---

## 12. DEFERRED / POST-MVP

| Item | Reason Deferred |
|---|---|
| Full DB documentation (formal .docx) | Not yet produced — was next step when this summary was created |
| Payroll module | External payroll system handles disbursement; Minerva only exports |
| Service charge UI/computation | Schema ready; UI deferred post-MVP |
| 13th month UI | Schema ready; UI deferred post-MVP |
| Broken-time UI in schedule grid | Schema ready; single-block shifts for MVP prototype |
| DOLE compliance notification tracker | Schema ready (`tbl_dole_notification`); UI deferred |
| Julie build | Post-Minerva; separate product |
| Multi-brand biometric adapter | Julie only |
| Mobile/selfie attendance | Julie only |
| All statutory PH leave types (maternity, etc.) | Schema seeded; UI only shows VL/SL for Minerva |
| Position-based leave allocation | Schema ready (`tbl_leave_tier_config`); not active for Minerva |
| tbl_user_scope for HR Admin (module-level scoping) | Schema ready; UI deferred |
| Employee portal (employee self-service) | Not in scope for Minerva |
| Wage distortion detection | Schema supports; business logic deferred |

---

## 13. OPEN QUESTIONS (Unresolved at Time of Summary)

1. **Formal database documentation (.docx/.pdf)** — Was the immediate next task. User asked for schema first; doc was next. Use the schema in Section 9 as the authoritative source.

2. **Frontend prototype pages per role** — User said they would provide a complete list of pages, features, specs, and modules per user role to guide the prototype build. This was not yet provided.

3. **Sample/dummy data for testing** — User confirmed they want dummy data created for employee records (based on the masterlist format). Not yet created.

4. **Biometric re-enrollment exact flow** — Whether existing employees' biometric user IDs will be re-enrolled by physically re-enrolling on device, or edited via ZKTeco's desktop software (`ZKTime.NET` or similar). The schema supports both; the API endpoint behavior differs slightly.

5. **Night shift meal break / ND hours** — Employees on graveyard (10PM–6AM) don't have a lunch break; they have shorter breaks. If `break_deduct_hours = 1.00` is applied, it deducts from their ND hours. Need to confirm: should break deduction be exempt from ND hours? Or should the deduction only apply to shifts that cross standard daytime hours? Current schema: break deduction is applied uniformly. This may need a `break_deduct_applies_to_nd` boolean on `tbl_computation_rules`.

6. **Admin role scope** — Confirmed as "more than just skinned HR." Exact module access matrix for admin role not yet finalized. Currently: same pages as HR minus settings, write actions, and payroll data. If there are pages admin should access that HR cannot, or vice versa, define them.

7. **`tbl_schedule` UNIQUE constraint conflict with split shifts** — The current unique key `uq_schedule_emp_date (employee_id, date)` prevents two schedule rows for the same employee on the same date. But split shifts store the continuation block in `continuation_shift_id` on the same row (not a second row), so this is not actually a conflict. Confirmed OK as designed. Just note it for the developer.

---

## 14. WHAT TO DO NEXT (For the Continuing Developer/Claude)

In priority order:

1. **Produce the formal database documentation** — Use this schema (Section 9) as the source. Format to match the style of the old DB doc (PDF provided earlier in conversation). Include all 37 tables, design rules, relationship summary, computation reference, seeded data, and notation legend.

2. **Build the static frontend prototype** — All 5 roles, all modules, mock data. Use `MINERVA_HRIS_DOCUMENTATION.md` (provided by user) as the feature/flow spec. Use the old HTML prototype (`hrms-v5-og.html`) as a loose visual reference.

3. **Wire the biometric bridge** — Adapt `zk-sync.js` to work with the new schema. Key changes: `tbl_employee` → `tbl_employees`, `tbl_device_logs` → `tbl_raw_device_logs`, add `tbl_employee_biometric_enrollment` join for reconciliation, implement three-tier matching, add conflict detection before push.

4. **Wire the timekeeping computation engine** — Compare `tbl_schedule` vs `tbl_raw_device_logs`, populate `tbl_timekeeping`, `tbl_deduction`, `tbl_additional`, `tbl_dod`. Apply `day_scenario` based on `tbl_holiday` and `tbl_schedule_date_annotation`.

5. **Build remaining API endpoints** — Follow the endpoint list in `HEAD_OPS_TO_HR_SCHEDULE_FLOW.md` as a reference. Update table names to match new schema.

---

*End of context summary. All decisions above were made collaboratively across approximately 20 rounds of Q&A. The schema in Section 9 is the single source of truth.*
