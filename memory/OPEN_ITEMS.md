# MINERVA HRIS — Open Items, Remaining Answers, and Full Audit
**Date:** April 25, 2026  
**Purpose:** Answer all questions from the final message that were not fully resolved in the context summary, plus a complete audit of remaining inconsistencies, conflicts, and gaps across the entire schema and system design.

---

## PART 1 — ARE THESE ANSWERED? STATUS PER ITEM

### Shift Pattern Analysis — Meal Break / Punch Abuse / Edge Cases
**Status: Answered in context summary (Section 6.8), documented for developer. Not yet implemented.**

The full punch flow edge case list is documented in Section 6.8 of `MINERVA_CONTEXT_SUMMARY.md`. It covers meal break auto-deduct + `break_verified` supervisor attestation, early OT vs early bird differentiation via `early_ot_threshold_minutes`, ghost punch detection via `anomaly_flag`, missed punch detection via buffer + notification, duplicate punch suppression, near-window tolerance, OT without form flagging. All documented. None yet wired.

---

### Shift Label / Block Architecture — `slot_order` Explanation
**Status: Answered in context summary (Section 8.2).**

`slot_order` is just a display integer — it controls which column appears first (1), second (2), third (3) on the schedule grid. It has no computational meaning. The unique constraint `(subdepartment_id, slot_order)` prevents two slots from occupying the same column position within the same subdepartment.

**Can users set as many shift presets as they want?**  
**Status: NOT explicitly answered. Answering now.**

Yes. `tbl_shift` is a global preset library with no enforced limit. `tbl_shift_pool` maps presets to a subdepartment's rotation pool — again, no limit. `tbl_shift_slot` defines named grid columns per subdepartment — also no limit. In practice, the schedule grid gets unwieldy past 5–6 slots, so the UI may eventually add a soft warning, but the database imposes no cap. Users can create as many shift presets as operationally needed.

---

### Gap II — 201/202 File Format
**Status: Answered. Implemented via `tbl_employee_document`. 201 = `is_active=TRUE`, 202 = `is_active=FALSE` + `date_separated` populated.**

---

### Gap KK — Missing Fields from Masterlist + NULL Handling
**Status: Partially answered. Schema gaps addressed. NULL policy not fully written out.**

All masterlist columns are now in `tbl_employees` or their respective child tables. Here is the definitive NULL policy:

**MUST NOT be NULL (required at employee creation):**
- `employee_number`, `last_name`, `first_name`, `company_id`, `department_id`, `subdepartment_id`, `employment_type_id`, `employee_status_id`, `date_hired`

**SHOULD be collected but technically nullable (soft required — flag in UI, not DB constraint):**
- `gender`, `date_of_birth`, `present_address`, `contact_number`, `sss_number`, `philhealth_number`, `pagibig_number`, `tin_number`

**Fully nullable — fill later or as applicable:**
- `middle_name`, `middle_initial`, `name_suffix`, `province`, `email_address`, `education_attainment`, `education_course`, `dependent_count`, `payroll_account_number`, `basic_salary` (required before first payroll, not at creation), `allowance`, `previous_salary`, `training_start_date`, `training_end_date`, `probationary_start_date`, `date_regularized`, `date_separated`, `separation_type`, `separation_reason`, `final_clearance`, `biometric_device_uid`, `biometric_name`, `import_batch_id`, `remarks`, `schedule_eligible_from_cutoff_id`

**Rule for UI:** Display required fields with `*`. Nullable fields shown but not blocking. The import flow shows unfilled required fields as red (hard error) and missing soft-required fields as amber (soft warning, can still commit).

---

### Salary Tiers and Conflicts
**Status: Answered in context summary (Section 6.3).**

Three-tier precedence: individual salary → position rate → wage floor. Tiers are labels, not hard constraints. Warning when individual salary falls below tier or floor — never a hard block. Salary band labels stored as `salary_band_label` varchar on `tbl_position_rate`.

---

### Training Period / Probation / Employment Timeline — "Still Blurry"
**Status: Partially answered. Need to explain the timeline clearly.**

**Plain explanation of the full employment timeline:**

Day 0 = Employee signs contract and starts work. This is `date_hired`. This is the legal start date for everything.

**Days 1–16: Training period** (internal label only; legally they are already an employee)
- `training_start_date = date_hired`
- `training_end_date = date_hired + 15 days`
- `employee_status = On Training`
- They receive salary, SSS, PhilHealth, Pag-IBIG from Day 1. The law does not recognize "training period" as pre-employment.

**Days 17–196: Probationary period** (180 calendar days from `date_hired`)
- `probationary_start_date = date_hired + 16 days` (operational label; legally still day 17 of the 180-day count)
- `employee_status = Probationary`
- The 180-day clock started on `date_hired`, not on Day 17. So by Day 196, the legal probationary period is already complete.
- The system uses `date_hired` to compute regularization eligibility. `probationary_start_date` is for HR's operational tracking only.

**Day 181 (from `date_hired`): Legal regularization threshold**
- `date_regularized = date_hired + 180 days`
- `employee_status = Active`
- If `auto_regularize = TRUE`, the nightly job does this automatically.
- If `auto_regularize = FALSE`, HR receives a notification and must confirm manually.

**Timeline visual:**
```
Day 1       Day 17      Day 181         Day ~365
|-----------|-----------|----------------|------->
  Training   Probationary   Regular        1-year anniversary
  (16 days)  (164 days)                    → Year 2 leave tier
              ←--- 180 days from Day 1 --→
```

**Answer to "another 6 months and they have a stint of 1 year":**  
Yes, exactly. If hired on January 1:
- January 1 = Day 1 (training starts, probation clock starts)
- January 16 = Day 16 (end of 16-day training window)
- January 17 = Day 17 (probationary label applied internally)
- June 29 = Day 180 (legal regularization threshold)
- January 1 of next year = 1 full year at the company → Year 2 leave tier (6 days)

The "another 6 months" comes from the fact that regularization happens at ~6 months, so the employee has been working since Day 1. Their 1-year anniversary is still 12 months from `date_hired` regardless.

---

### Biometric Conflict Prevention — Accidental UID Changes
**Status: Answered in context summary (biometric section). Gap around accidental changes NOT fully addressed.**

**The scenario you raised:** What if a device user ID gets changed accidentally in the device logs or database — either on the device side (IT Admin edits the wrong record in ZKTeco's software) or on the Minerva side (someone updates `biometric_device_uid` to the wrong value)?

**How the schema handles this:**

1. `tbl_employee_biometric_enrollment` has `UNIQUE (device_id, device_user_id)` — prevents duplicate assignment at the DB level for future assignments.

2. `tbl_biometric_enrollment_log` records every push attempt with `attempted_uid`, `result`, and `performed_by`. If a UID is changed, there is an audit trail of who changed it and when.

3. `tbl_audit_log` fires `EMPLOYEE_UPDATED` when `biometric_device_uid` is changed on `tbl_employees`, with `old_value` and `new_value` captured. This means any accidental change is reversible — IT Admin can look at the audit log, find the old UID, and restore it.

4. If a UID is accidentally changed on the device side (outside Minerva), future punches will have a `device_user_id` that no longer matches `biometric_device_uid` in Minerva. Those punches land in `tbl_raw_device_logs` with `reconciliation_status = 'unresolved'` and appear in the IT Admin reconciliation queue. IT Admin then re-matches them manually, which also updates the employee record.

5. For the employee number format `1-052722-248`: if the embedded `248` (device user ID) changes, the employee number does NOT change. The employee number is generated once at hire and is permanent. Only `biometric_device_uid` in the DB reflects the current device assignment. The two are decoupled after initial setup.

**Additional safeguard to add (not yet in schema):**  
A `biometric_uid_change_log` (separate from the general audit log) that records: `employee_id`, `old_uid`, `new_uid`, `device_id`, `changed_by`, `change_reason`, `timestamp`. This makes UID history searchable without trawling the full audit log. Add to schema in next revision.

---

### Superadmin Role — Non-Technical Onboarding
**Status: Partially answered. The technical onboarding concern needs a concrete answer.**

**Question:** What if the person doing onboarding (superadmin) is not technical?

**Answer:**

The superadmin does not need to be technical. The onboarding wizard (a guided setup flow, not a raw config screen) handles all foundational setup. The wizard is a series of simple, guided steps:

1. **Company Setup** — Name, legal entity, TIN, region, contact. Form fields with labels. No technical knowledge required.
2. **Cutoff Setup** — "What date does your first payroll period start?" Single date picker. System auto-generates all future cutoffs.
3. **Department/Subdept/Position** — Add org structure. Same as editing any list. IT Admin can own this step.
4. **Leave Configuration** — "How many VL days do first-year employees get?" Simple number inputs.
5. **Rate Table** — Pre-filled with Philippine legal defaults (as seeded). HR reviews and adjusts only if the company differs from standard DOLE rates.
6. **Device Registration** — IP address + serial number input. IT Admin owns this step, not superadmin.

**Who actually does which steps:**
- Superadmin: Steps 1 and 2 (company identity and cutoff anchor — foundational, must be done first)
- IT Admin: Step 3 (org structure), Step 6 (devices), user accounts
- Coordinator: Shift presets + shift slots for their subdepartment
- HR Admin: Leave config, holidays, notification config

**The answer to "will coordinator configuring shift presets conflict with anything?"**  
No conflict. `tbl_shift` is a global table but coordinators are scoped to their subdepartment via `tbl_user_scope`. A coordinator can create shift presets (global library) and assign them to their subdepartment's pool (`tbl_shift_pool`) and slots (`tbl_shift_slot`). They cannot access or modify another coordinator's subdepartment. The only risk: a coordinator creates a globally-named shift preset (e.g., "Morning") that another coordinator also wants to create with slightly different times. Since shift names are globally unique (`UNIQUE KEY uq_shift_name`), the second coordinator will see a conflict. **Resolution:** Either coordinators coordinate naming (pun intended), or superadmin/IT Admin manages the global shift library and coordinators only do pool/slot assignment. For Minerva (two hotels, known structure), this is manageable. For Julie (SaaS, unknown clients), the global shift library should be scoped per company.

---

### Admin Role — "More Than Just Skinned HR"
**Status: Not fully resolved. Answering now.**

**What "view-only" means and why it may not be enough:**

A pure view-only role is appropriate when the role holder needs to see data but has no action authority. For a hotel context, possible candidates for the `admin` role:
- General Manager who wants to see attendance reports but shouldn't touch anything
- Owner/investor who wants dashboard visibility
- HR Assistant who can see but not approve
- Payroll processor who needs to read timekeeping data to feed the external payroll system

**Best practice recommendation:**

Keep `admin` as primarily read-only but give it meaningful read access — not just a stripped HR page. Specific pages `admin` should have that differ from HR:

| Module | HR | Admin |
|---|---|---|
| Dashboard | Full | Full (read) |
| Employee Masterlist | Full CRUD | Read + search only |
| Schedule Grid | View + force-publish | Read only |
| Timekeeping | View + override trigger | Read only |
| Reports | Full export | View only (no export) |
| Leave (list) | Approve/reject | View only |
| Audit Log | Full + export | Read only, no export |
| Settings | Full | **Hidden** |
| Devices | **Hidden** | **Hidden** |
| Override Queue | Approve | **Hidden** |
| Requests | Approve | View only |

**What makes `admin` "more" than skinned HR:**
Add a **Payroll Data View** tab that HR doesn't have — a read-only consolidated view of net hours, deductions, additionals, and computed pay data per employee per cutoff, formatted for export to the external payroll processor. This gives admin a distinct purpose: they are the **payroll data consumer**, not the HR decision-maker.

The `tbl_module_access` table handles all of this per-account. The `admin` role default grants are set at onboarding. `tbl_module_access` rows for each `admin` account can be fine-tuned by IT Admin or super_admin.

---

### Payroll for Minerva — Drop Service Charges and 13th Month?
**Status: Answered implicitly in the context summary. Explicit ruling needed.**

**Decision: YES, drop service charges and 13th month from Minerva's active development scope.**

The schema tables (`tbl_service_charge`, `tbl_service_charge_distribution`, `tbl_13th_month_pay`) remain in the database because they are needed for correctness and future-proofing. But:
- No UI screens for them in Minerva MVP
- No API endpoints for them in Minerva MVP
- No computation logic for them in Minerva MVP

They exist in the DB as placeholders with correct structure, ready to be activated post-MVP. This is consistent with the "schema is Julie-ready, features are Minerva-scoped" principle. The developer should not touch these tables during the MVP build.

---

### ND (Night Differential) Employees — Breaks
**Status: Answered in context summary (Section 6.8, ND meal break row) but not detailed enough. Answering fully now.**

**Employees on graveyard shifts (10PM–6AM) do not have a lunch break, but they do have rest breaks.**

**Philippine legal framework for rest breaks:**
- Article 83 of the Labor Code requires a 60-minute meal break for shifts that include a traditional meal time (lunch/dinner). For graveyard shifts, this is ambiguous.
- DOLE Handbook on Workers' Statutory Monetary Benefits states that rest periods of 5–20 minutes during the workday are considered working time and are compensable. Longer meal breaks (60+ minutes) are non-compensable.
- For graveyard workers: In practice, most Philippine employers give a 30-minute rest break (not a full meal break) around 2–3AM. This 30-minute break is typically treated as compensable working time (it is too short to be a meal break).

**Implication for schema:**

The `break_deduct_hours = 1.00` and `break_deduct_threshold_hours = 8.00` in `tbl_computation_rules` apply to standard daytime shifts. For graveyard shifts:
- If total hours ≤ 8: no break deduction (they worked 8 hours including their 30-min rest, which is compensable)
- If total hours > 8 (split/continuation block): break deduction logic applies to the excess hours only

**Schema fix needed:** Add `break_applies_to_graveyard BOOLEAN NOT NULL DEFAULT FALSE` to `tbl_computation_rules`. When `FALSE`, the break deduction is NOT applied to shifts where `tbl_shift.crosses_midnight = TRUE` and `tbl_shift.is_graveyard = TRUE`. When `TRUE`, it applies uniformly regardless of shift type.

This is important to get right before the timekeeping computation engine is built. Default for Minerva: `FALSE` (don't auto-deduct for graveyard).

---

### Development Timeline — Realistic Assessment
**Status: Answered in context summary. Repeating the verdict clearly.**

| Target | Your Plan | Realistic |
|---|---|---|
| Frontend prototype (all pages, all roles, static) | April 25 | April 28–30 |
| Timekeeping MVP + biometric live | April 27 | May 5–10 |
| Everything else (full wiring, all modules) | Post-April 30 | May–June |

**Brutal breakdown:**
- Static prototype for 5 roles × ~8 pages each = ~40 page states, all with mock data, role-switching, sidebar nav, and modal flows. For one person: 3–5 days minimum if moving fast.
- Biometric bridge adaptation alone (adapting `zk-sync.js` to new schema, implementing three-tier reconciliation, adding conflict detection) = 2–3 days.
- Timekeeping computation engine (schedule comparison, late/OT classification, deduction/additional population, anomaly flagging) = 3–5 days.
- The combination: April 27 is not achievable for live timekeeping. May 5–10 is realistic if the developer is focused solely on this.

**The right approach:** Ship the static prototype first (April 28–30). Get feedback. Then wire in priority order: biometric sync → raw log display → schedule grid → timekeeping computation → leave → reports. Do not try to wire everything at once.

---

### Gap NN — What Was This?
**Status: Not answered in context summary. Answering now.**

Gap NN was `tbl_schedule_date_annotation` — the table that stores coordinator-set date-level annotations on the schedule (OFF, DOD, FVL, REGOT, CHANGE_OFF, etc.). It was confirmed and added to the schema. The table exists in the final schema under Section 6 (Shifts & Scheduling). It is what allows coordinators to mark a specific date on an employee's schedule as "DOD" or "Regular OT" before punches come in, which then activates the correct computation flags in `tbl_timekeeping.day_scenario`.

---

## PART 2 — REMAINING GAPS, INCONSISTENCIES, AND CONFLICTS

### Schema-Level Issues

**Issue 1: `tbl_schedule` UNIQUE constraint vs relievers**  
`UNIQUE KEY uq_schedule_emp_date (employee_id, date)` means only one schedule row per employee per date. But a reliever who is activated mid-day to cover a gap needs a schedule row on the same date they already have an assigned shift. This is a conflict. **Resolution:** The unique constraint should be `(employee_id, date, is_reliever)` so a reliever row and a regular row can coexist for the same employee on the same date. Alternatively, reliever coverage goes entirely through `tbl_schedule_exception` (which already has `UNIQUE (employee_id, date)` — the same conflict exists there). **Recommended fix:** Move all reliever coverage to `tbl_schedule_exception` with `relief_type = 'reliever_activation'`. Relievers are not in `tbl_schedule` as a second row — they are in the exception table. The schedule row for the reliever's original shift (if any) stays in `tbl_schedule`.

**Issue 2: `tbl_schedule_exception` UNIQUE constraint vs same-day events**  
`UNIQUE KEY uq_exception_emp_date (employee_id, date)` means only one exception per employee per date. But a shift exchange AND a reliever activation could both affect the same employee on the same date. **Resolution:** Remove the UNIQUE constraint from `tbl_schedule_exception` on `(employee_id, date)`. Replace with a business-logic check: at most one active exception of each `relief_type` per employee per date. Add a partial unique index or handle in application layer.

**Issue 3: `tbl_raw_device_logs` has no index on `(device_user_id, record_time)`**  
The reconciliation query and the punch resolver both filter by `device_user_id` and `record_time`. Without an index, these queries do full table scans as the log grows. Add: `KEY idx_rdl_user_time (device_user_id, record_time)`.

**Issue 4: `tbl_timekeeping.schedule_id` is nullable but should be required after schedule publish**  
The column is nullable to accommodate timekeeping records for employees without a published schedule (e.g., mid-cutoff hires or raw punch records before schedule is published). This is correct behavior. However, the computation engine cannot correctly classify early OT, late deduction, or regular hours without a `schedule_id`. The system should flag timekeeping rows where `schedule_id IS NULL` as "unclassified" and notify IT Admin/HR. Add `classification_status ENUM('classified','unclassified','manual_review')` to `tbl_timekeeping`.

**Issue 5: `tbl_shift.total_hours` is in the DDL but marked as "computed at application layer; not stored"**  
The column exists on the table (`total_hours DECIMAL(5,2) NULL`) but the comment says not to store it. This is inconsistent — if it's not stored, the column should not exist. Either use a MySQL generated column (`GENERATED ALWAYS AS (TIMEDIFF(time_out, time_in)) VIRTUAL`) or remove the column entirely and compute at the API layer. Remove the physical column to avoid stale data risk.

**Issue 6: `tbl_leave_balance.remaining_credits` is a stored column that duplicates `total_credits - used_credits`**  
If `remaining_credits` is stored, it must be updated every time `used_credits` changes. A missed update creates a data inconsistency. Use a MySQL generated column: `remaining_credits DECIMAL(5,2) GENERATED ALWAYS AS (total_credits - used_credits + carryover_credits) STORED`. This makes it always accurate without application-layer maintenance.

**Issue 7: `tbl_cutoff_period` has no unique constraint on `(company_id, start_date)`**  
Nothing prevents two cutoff periods for the same company starting on the same date. Add: `UNIQUE KEY uq_cutoff_company_start (company_id, start_date)`.

**Issue 8: `tbl_holiday` has no unique constraint on `(company_id, holiday_date)`**  
The same date could be inserted twice for the same company (or NULL company) with different names. Add: `UNIQUE KEY uq_holiday_company_date (company_id, holiday_date)`. For NULL company_id (applies to both), use a partial index or application-layer check since MySQL unique indexes treat NULL values as distinct.

**Issue 9: `tbl_form_upload.exchange_partner_id` has no FK constraint in the final DDL**  
The FK `fk_formup_partner` is defined in the DDL (`CONSTRAINT fk_formup_partner FOREIGN KEY (exchange_partner_id) REFERENCES tbl_employees(employee_id)`). Verified present — this is actually fine. No issue.

**Issue 10: `tbl_notification.trigger_type` FK to `tbl_notification_config(trigger_type)`**  
`tbl_notification_config.trigger_type` is a VARCHAR unique key, not a primary key integer. Using it as a FK target is valid in MySQL (a unique key can be a FK target) but it means if the trigger_type string ever changes in `tbl_notification_config`, all related `tbl_notification` rows break. This is unlikely but fragile. Consider adding a surrogate `config_id` FK instead, or treat it as a soft reference (no FK, just a matching string). For Minerva, trigger_type strings are stable enum-like values, so it's acceptable as-is.

**Issue 11: `tbl_13th_month_pay` and `tbl_service_charge_distribution` have no `cutoff_id` reference**  
`tbl_service_charge_distribution` links to `tbl_service_charge` which links to `cutoff_id` — correct. `tbl_13th_month_pay` links only to `employee_id` and `year` — no cutoff link. This is intentional (13th month is annual, not per-cutoff). Acceptable.

**Issue 12: `tbl_employee_employment_history` has no unique constraint**  
Multiple history rows with the same `employee_id`, `start_date`, `employment_type_id` can exist. This isn't necessarily wrong (an employee could have overlapping records if data entry errors occur) but it should at minimum have a unique constraint on `(employee_id, start_date, employment_type_id)` to prevent obvious duplicates.

**Issue 13: `tbl_user_account` has `UNIQUE KEY uq_employee_account (employee_id)` but `employee_id` is nullable**  
MySQL unique indexes on nullable columns treat each NULL as distinct — meaning two bootstrap/system accounts (both with `employee_id = NULL`) could exist simultaneously. This breaks the "one bootstrap account" rule. **Resolution:** Application-layer enforcement: only one account may have `is_bootstrap = TRUE`. Add a partial unique index or a CHECK constraint: `CONSTRAINT chk_bootstrap CHECK (is_bootstrap = FALSE OR employee_id IS NULL)` combined with application logic that blocks creating a second bootstrap.

**Issue 14: `tbl_module_access.module_key` has no reference table**  
Module keys are free-text strings (`'reports'`, `'settings'`, `'audit_export'`). There is no table of valid module keys, so a typo in `module_key` silently creates an inaccessible permission. For Minerva, this is manageable since the module key list is small and seeded. For Julie, a `tbl_module` reference table is needed. Note this for Julie.

---

### Logic and Flow Issues

**Issue 15: Schedule-to-timekeeping comparison flow is not yet wired and has no documented algorithm**  
The core of the system — comparing `tbl_schedule.shift_id → tbl_shift.time_in/time_out` against `tbl_raw_device_logs` punches — has no implementation plan documented. The schema supports it but the algorithm is undefined. Before the developer builds the computation engine, this algorithm must be specified. Documented here as a deliverable.

**Proposed algorithm (for developer reference):**
```
For each employee per day:
1. Pull the published schedule row (tbl_schedule WHERE date=X AND employee_id=Y AND is_draft=FALSE)
2. Pull all punch records from tbl_raw_device_logs WHERE device_user_id matches AND DATE(record_time)=X
   (For graveyard: also check date-1 for overnight completion)
3. Pair punches: 1st=IN, 2nd=OUT. For split shifts: 3rd=IN (continuation), 4th=OUT.
4. Compare paired punches to scheduled time_in/time_out:
   a. punch_in < scheduled_time_in - early_ot_threshold → flag early OT
   b. punch_in > scheduled_time_in + grace_period → flag late
   c. punch_in within [scheduled_time_in - early_ot_threshold, scheduled_time_in + grace_period] → on time
   d. punch_out > scheduled_time_out + late_ot_threshold → flag late OT
   e. punch_out < scheduled_time_out → flag undertime
5. Compute segment_hours = (punch_out - punch_in) adjusted for crosses_midnight
6. Compute total_hours_day = SUM(segment_hours for all segments on this date)
7. Apply break deduction if total_hours_day > break_deduct_threshold_hours AND shift is not graveyard (or break_applies_to_graveyard=TRUE)
8. Determine day_scenario from tbl_holiday + tbl_schedule_date_annotation
9. Populate tbl_timekeeping, tbl_deduction, tbl_additional, tbl_dod
```

**Issue 16: No mechanism to handle a punch that arrives before the schedule is published**  
If a biometric sync runs before the schedule is published (or for an employee with no schedule), punches land in `tbl_raw_device_logs` with `reconciliation_status='resolved'` but no corresponding `tbl_timekeeping` row is created (because there's no schedule to compare against). These punches would be orphaned. **Resolution:** Create a `tbl_timekeeping` row with `schedule_id=NULL` and `classification_status='unclassified'`. Notify HR. When the schedule is later published, a recomputation job retroactively classifies unclassified rows.

**Issue 17: `tbl_schedule_date_annotation` and `tbl_schedule.sched_type` overlap**  
`tbl_schedule` has `sched_type ENUM('regular','off','absent','on_leave','fvl','dod','regot','changeoff','holiday','absent_with_notice')` AND there is `tbl_schedule_date_annotation` with `annotation_type ENUM(...)`. These serve overlapping purposes. If both exist, which one wins? Which is the authoritative status? **Resolution:** `tbl_schedule.sched_type` is the coordinator's pre-planned assignment (set during schedule drafting). `tbl_schedule_date_annotation` is a more detailed, multi-valued annotation (a date can have multiple annotations simultaneously, e.g., `dod` AND `regular_ot`). Keep both. `sched_type` is the primary label shown on the schedule grid cell. Annotations are additional computation-activating flags on the same date. Document this distinction clearly for the developer.

**Issue 18: DOD noted in schedule but DOD pay computed after timekeeping**  
The schedule shows `DOD` in a cell, meaning the coordinator has pre-noted this employee is working on a rest day. But `tbl_dod` is created by the computation engine after punches come in. The gap: if the coordinator marks DOD in the schedule but no punch comes in, the system should flag it as a DOD absence (not just a regular absence). The `activates_dod = TRUE` flag on `tbl_schedule_date_annotation` should trigger creation of a `tbl_dod` record during computation, even when `dod_ot = 0.00` and `dod_nd = 0.00`, so that the DOD status is preserved in the timekeeping output. The computation engine must check annotations before creating the `tbl_dod` row.

**Issue 19: `tbl_cutoff_schedule_status` `noted_by_user_id` not added**  
In Round 4, QF1, you confirmed adding `noted_by_user_id` and `noted_at` to `tbl_cutoff_schedule_status` to capture the Operations Head's schedule sign-off. These columns are NOT in the current schema. **Add:**
```sql
noted_by_user_id INT NULL,
noted_at TIMESTAMP NULL,
CONSTRAINT fk_noted_user FOREIGN KEY (noted_by_user_id) REFERENCES tbl_user_account(user_acc_id)
```

**Issue 20: No `biometric_uid_change_log` table**  
Confirmed needed in this session (see Part 1, biometric accidental change section). Not in schema. Add:
```sql
CREATE TABLE tbl_biometric_uid_change_log (
  change_id    INT AUTO_INCREMENT PRIMARY KEY,
  employee_id  INT NOT NULL,
  device_id    INT NOT NULL,
  old_uid      VARCHAR(50) NULL,
  new_uid      VARCHAR(50) NULL,
  changed_by   INT NOT NULL,
  change_reason VARCHAR(500) NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_biochange_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_biochange_device   FOREIGN KEY (device_id)   REFERENCES tbl_device(device_id)
);
```

**Issue 21: `break_applies_to_graveyard` config field missing**  
Confirmed needed in this session (ND break section). Not in schema. Add to `tbl_computation_rules`:
```sql
break_applies_to_graveyard BOOLEAN NOT NULL DEFAULT FALSE
```

**Issue 22: `classification_status` missing from `tbl_timekeeping`**  
Confirmed needed (Issue 16). Add to `tbl_timekeeping`:
```sql
classification_status ENUM('classified','unclassified','manual_review') NOT NULL DEFAULT 'unclassified'
```

**Issue 23: No `is_graveyard` flag on `tbl_shift`**  
`tbl_shift_pool` has `is_graveyard`, but `tbl_shift` itself does not. The computation engine needs to know if a shift is graveyard when `tbl_timekeeping` is created. It currently has to join through `tbl_shift_pool` to find this flag — but an employee may not always be in a pool (ad-hoc shifts). Add `is_graveyard BOOLEAN NOT NULL DEFAULT FALSE` directly to `tbl_shift`. The coordinator sets this when creating the preset.

**Issue 24: `tbl_schedule.flex_time_in/flex_time_out` vs `continuation_shift_id` redundancy**  
`tbl_schedule` has both `continuation_shift_id` (FK to `tbl_shift`) and `flex_time_in/flex_time_out` (raw time values). If `continuation_shift_id` is set, `flex_time_in/flex_time_out` should be derived from that shift's `time_in/time_out`. If they're stored separately, they can go out of sync if the shift preset is edited. **Resolution:** Keep `continuation_shift_id` as the FK reference. Compute `flex_time_in/flex_time_out` at the application layer from the FK. Remove the physical `flex_time_in/flex_time_out` columns or make them override fields that only populate when the continuation time differs from the preset (e.g., reliever with a partial time window). Document clearly.

**Issue 25: `tbl_schedule.shift_order` and `tbl_shift_slot.slot_order` are both in the schedule but serve slightly different purposes**  
`slot_order` is the column position on the grid (display). `shift_order` on `tbl_schedule` is a label (1st shift, 2nd shift, 3rd shift, Reliever). These are related but different. A schedule row assigned to slot_id 2 (Restobar, slot_order=2) might have shift_order=2. But they don't have to match and there's no constraint enforcing consistency. This could cause display confusion. **Resolution:** Deprecate `shift_order` on `tbl_schedule` — let the schedule grid derive display order from `slot_id → tbl_shift_slot.slot_order`. One source of truth for ordering. Remove `shift_order` from `tbl_schedule` entirely in the next revision.

---

### Missing Items Still Not in Schema

**Missing 1: `tbl_biometric_uid_change_log`** — See Issue 20.

**Missing 2: `break_applies_to_graveyard`** on `tbl_computation_rules` — See Issue 21.

**Missing 3: `classification_status`** on `tbl_timekeeping` — See Issue 22.

**Missing 4: `is_graveyard`** on `tbl_shift` — See Issue 23.

**Missing 5: `noted_by_user_id` and `noted_at`** on `tbl_cutoff_schedule_status` — See Issue 19.

**Missing 6: Index on `tbl_raw_device_logs (device_user_id, record_time)`** — See Issue 3.

**Missing 7: UNIQUE constraint on `tbl_cutoff_period (company_id, start_date)`** — See Issue 7.

**Missing 8: UNIQUE constraint on `tbl_holiday (company_id, holiday_date)`** — See Issue 8.

**Missing 9: UNIQUE constraint on `tbl_employee_employment_history (employee_id, start_date, employment_type_id)`** — See Issue 12.

---

## PART 3 — THINGS STILL MARKED "UNSURE" BY THE CLIENT

These items were raised but the client explicitly said they were unsure. They need decisions before wiring begins.

| Item | Status | Required by |
|---|---|---|
| Whether graveyard employees' break deduction should apply | UNSURE | Before timekeeping engine build |
| Admin role exact module access matrix | UNSURE | Before prototype build |
| Whether mid-cutoff employee entry is truly "next cutoff only" or configurable | UNSURE — tentatively "next cutoff" | Before schedule grid build |
| FDA = Front Desk Attendant, FDB = Food & Beverage Duty Breakfast — station naming convention, whether codified in DB | Confirmed as naming convention only; not stored | Noted |
| Whether the Operations Head schedule approval (`noted_by_user_id`) is a hard workflow step or optional | UNSURE | Before schedule publish flow is built |
| Whether the schedule grid should show FDA/FDB as position labels on cells | UNSURE | Before prototype build |

---

## PART 4 — IMMEDIATE SCHEMA PATCHES NEEDED BEFORE DEVELOPMENT STARTS

These are concrete DDL changes that must be applied to the schema before the developer begins wiring:

```sql
-- 1. Add is_graveyard to tbl_shift
ALTER TABLE tbl_shift
  ADD COLUMN is_graveyard BOOLEAN NOT NULL DEFAULT FALSE AFTER crosses_midnight;

-- 2. Add break_applies_to_graveyard to tbl_computation_rules
ALTER TABLE tbl_computation_rules
  ADD COLUMN break_applies_to_graveyard BOOLEAN NOT NULL DEFAULT FALSE
  AFTER break_deduction_enabled;

-- 3. Add classification_status to tbl_timekeeping
ALTER TABLE tbl_timekeeping
  ADD COLUMN classification_status
    ENUM('classified','unclassified','manual_review')
    NOT NULL DEFAULT 'unclassified'
  AFTER is_absent;

-- 4. Add noted_by to tbl_cutoff_schedule_status
ALTER TABLE tbl_cutoff_schedule_status
  ADD COLUMN noted_by_user_id INT NULL AFTER publish_source,
  ADD COLUMN noted_at TIMESTAMP NULL AFTER noted_by_user_id,
  ADD CONSTRAINT fk_noted_user
    FOREIGN KEY (noted_by_user_id) REFERENCES tbl_user_account(user_acc_id);

-- 5. Add index to tbl_raw_device_logs
ALTER TABLE tbl_raw_device_logs
  ADD KEY idx_rdl_user_time (device_user_id, record_time);

-- 6. Add unique constraint to tbl_cutoff_period
ALTER TABLE tbl_cutoff_period
  ADD UNIQUE KEY uq_cutoff_company_start (company_id, start_date);

-- 7. Create tbl_biometric_uid_change_log
CREATE TABLE tbl_biometric_uid_change_log (
  change_id     INT AUTO_INCREMENT PRIMARY KEY,
  employee_id   INT NOT NULL,
  device_id     INT NOT NULL,
  old_uid       VARCHAR(50) NULL,
  new_uid       VARCHAR(50) NULL,
  changed_by    INT NOT NULL,
  change_reason VARCHAR(500) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_biochange_employee FOREIGN KEY (employee_id) REFERENCES tbl_employees(employee_id),
  CONSTRAINT fk_biochange_device   FOREIGN KEY (device_id)   REFERENCES tbl_device(device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Fix remaining_credits to be a generated column
-- (Requires dropping and re-adding the column — do at migration time, not ALTER)
-- remaining_credits DECIMAL(5,2) GENERATED ALWAYS AS
--   (total_credits - used_credits + carryover_credits) STORED

-- 9. Remove redundant shift_order from tbl_schedule
-- (derive from slot_id → tbl_shift_slot.slot_order instead)
-- ALTER TABLE tbl_schedule DROP COLUMN shift_order;

-- 10. Remove total_hours from tbl_shift (or convert to VIRTUAL)
-- ALTER TABLE tbl_shift DROP COLUMN total_hours;
-- OR:
-- ALTER TABLE tbl_shift MODIFY total_hours DECIMAL(5,2)
--   GENERATED ALWAYS AS (
--     CASE WHEN crosses_midnight
--       THEN ((24*60 - TIME_TO_SEC(time_in)/60) + TIME_TO_SEC(time_out)/60) / 60
--       ELSE (TIME_TO_SEC(time_out) - TIME_TO_SEC(time_in)) / 3600
--     END
--   ) VIRTUAL;
```

---

*End of audit. Apply the patches in Part 4 to finalize the schema before development begins.*
