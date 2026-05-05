# Masterlist Column Headers — DB Coverage Map

> Source: `Updated_Masterlist_sample__4_.xlsx` — Sheet: UTH  
> Schema ref: `tbl_employees`, `tbl_employee_position`, `tbl_employee_emergency_contact`  
> Import map: `tbl_import_column_map` (seeded in `004_import_map_patches.sql`)  
> Last updated: 2026-04-28

## Status Legend

| Symbol | Meaning |
|---|---|
| ✅ | Stored directly — field exists in DB and import map |
| 🔄 | Derived at query time — no DB column; import skips |
| ⚙️ | Validate-only — read by import engine but never stored |
| 📍 | Positional — no text header; engine maps by column index |
| ⚠️ | Partial — covered but with caveats noted |
| ❓ | Pending client confirmation |

---

## Headers Table

| Excel Col | # | Header | DB Table / Column | Import Map Field | Status | Notes |
|-----------|---|--------|-------------------|-----------------|--------|-------|
| B | 1 | Last Name | `tbl_employees.last_name` | `field_last_name` | ✅ | |
| C | 2 | First Name | `tbl_employees.first_name` | `field_first_name` | ✅ | |
| D | 3 | Middle Name | `tbl_employees.middle_name` | `field_middle_name` | ✅ | |
| E | 4 | Middle Initial | `tbl_employees.middle_initial` | `field_middle_initial` | ✅ | |
| F | 5 | Suffix | `tbl_employees.name_suffix` | `field_name_suffix` | ✅ | |
| G | 6 | Full Name | — | — | 🔄 | Format: Last, First MI. — derive via `formatEmployeeName()` |
| H | 7 | Full Name | — | — | 🔄 | Format: First MI. Last |
| I | 8 | Full Name | — | — | 🔄 | Format: Last, First Middle (full) |
| J | 9 | Position | `tbl_employee_position.position_id` | `field_position` | ⚠️ | Resolves via name lookup; inserts to child table not `tbl_employees` directly |
| K | 10 | Sub Department | `tbl_employees.subdepartment_id` | `field_subdepartment` | ✅ | |
| L | 11 | Department | `tbl_employees.department_id` | `field_department` | ✅ | |
| M | 12 | Employment Status | `tbl_employees.employment_type_id` + `employee_status_id` | `field_employment_type` + `field_employee_status` | ⚠️ | Both map to same column; engine does dual lookup — see Gap 1 note |
| N | 13 | Company | `tbl_employees.company_id` | `field_company` | ✅ | |
| O | 14 | Employee's ID No. | `tbl_employees.employee_number` | `field_employee_number` | ✅ | |
| P | 15 | Hired Date | `tbl_employees.date_hired` | `field_date_hired` | ✅ | Excel serial auto-detected |
| Q | 16 | Training | `tbl_employees.training_start_date` | `field_training_start` | ✅ | Merged header "Training" spans Q-R |
| R | 17 | *(no header)* | `tbl_employees.training_end_date` | `field_training_end` | 📍 | Positional: column immediately after Q. Import map value set to NULL until positional mapping confirmed. |
| S | 18 | Probationary | `tbl_employees.probationary_start_date` | `field_probationary_start` | ✅ | Merged header spans S-T |
| T | 19 | *(no header)* | — | — | ⚙️ | Probationary end: never stored. Engine computes `date_hired + 180 days` and cross-checks. Warning if >5 day deviation. |
| U | 20 | Date Today | — | — | 🔄 | System date — skip entirely |
| V | 21 | Year | — | — | 🔄 | Tenure year component — derived from `date_hired` |
| W | 22 | Month | — | — | 🔄 | Tenure month component — derived |
| X | 23 | Day | — | — | 🔄 | Tenure day component — derived |
| Y | 24 | Regularization | `tbl_employees.date_regularized` | `field_date_regularized` | ✅ | Excel serial auto-detected |
| Z | 25 | 1st Position | `tbl_employee_position` (row 1) | `field_position_1` | ✅ | Inserted after main employee row; `is_primary = FALSE` |
| AA | 26 | Coverage Date | `tbl_employee_position.position_start_date` (row 1) | `field_position_1_start` | 📍 | Header "Coverage Date" is duplicate; engine uses positional — next column after Z |
| AB | 27 | 2nd Position | `tbl_employee_position` (row 2) | `field_position_2` | ✅ | |
| AC | 28 | Coverage Date | `tbl_employee_position.position_start_date` (row 2) | `field_position_2_start` | 📍 | Positional — next column after AB |
| AD | 29 | Previous Salary | `tbl_employees.previous_salary` | `field_previous_salary` | ✅ | |
| AE | 30 | Basic Salary | `tbl_employees.basic_salary` | `field_basic_salary` | ✅ | |
| AF | 31 | Allowance | `tbl_employees.allowance` | `field_allowance` | ✅ | |
| AG | 32 | Monthly Gross Pay | — | `field_monthly_gross` | ⚙️ | Validate-only: engine checks `|AG − (AE + AF)| ≤ ₱1`. Warning if mismatch. Never stored. |
| AH | 33 | Daily rate | — | `field_daily_rate` | ⚙️ | Back-calculate `basic_salary = AH × pay_factor` if AE is null; else cross-validate within 5% tolerance. Never stored. |
| AI | 34 | Type of payroll | `tbl_employees.payroll_type` | `field_payroll_type` | ✅ | |
| AJ | 35 | Payroll Account No. | `tbl_employees.payroll_account_number` | `field_payroll_account` | ✅ | |
| AK | 36 | Gender | `tbl_employees.gender` | `field_gender` | ✅ | |
| AL | 37 | Civil Status | `tbl_employees.civil_status` | `field_civil_status` | ✅ | |
| AM | 38 | Birthday | `tbl_employees.date_of_birth` | `field_date_of_birth` | ✅ | Excel serial auto-detected |
| AN | 39 | Age | — | — | 🔄 | Derived from `date_of_birth`; skip entirely |
| AO | 40 | Present Address | `tbl_employees.present_address` | `field_address` | ✅ | |
| AP | 41 | Province | `tbl_employees.province` | `field_province` | ✅ | |
| AQ | 42 | Contact Number | `tbl_employees.contact_number` | `field_contact_number` | ✅ | |
| AR | 43 | Email Address | `tbl_employees.email_address` | `field_email_address` | ✅ | |
| AS | 44 | Education Attainment | `tbl_employees.education_attainment` | `field_education_attainment` | ✅ | |
| AT | 45 | Course | `tbl_employees.education_course` | `field_education_course` | ✅ | |
| AU | 46 | SSS | `tbl_employees.sss_number` | `field_sss` | ✅ | |
| AV | 47 | Philhealth | `tbl_employees.philhealth_number` | `field_philhealth` | ✅ | |
| AW | 48 | PagIBIG No. | `tbl_employees.pagibig_number` | `field_pagibig` | ✅ | |
| AX | 49 | TIN | `tbl_employees.tin_number` | `field_tin` | ✅ | |
| AY | 50 | No. of Dependents | `tbl_employees.dependent_count` | `field_dependent_count` | ✅ | |
| AZ | 51 | Contact Person | `tbl_employee_emergency_contact.contact_name` | `field_emergency_contact_name` | ✅ | |
| BA | 52 | Relationship | `tbl_employee_emergency_contact.relationship` | `field_emergency_contact_rel` | ✅ | |
| BB | 53 | ER Contact No. | `tbl_employee_emergency_contact.contact_number` | `field_emergency_contact_phone` | ✅ | |
| BC | 54 | Remarks | `tbl_employees.remarks` | `field_remarks` | ✅ | |
| BD+ | — | *(separation columns — unconfirmed)* | `tbl_employees.date_separated`, `separation_type`, `separation_reason` | `field_date_separated`, `field_separation_type`, `field_separation_reason` | ❓ | Client to confirm column headers after BC. Map fields added; values NULL in seed profile until confirmed. |

---

## Summary

| Category | Count |
|---|---|
| Total Excel columns (B–BC) | 54 |
| Stored in DB | 40 |
| Derived / skip on import | 9 |
| Validate-only (read but not stored) | 2 |
| Positional (no text header) | 3 |
| Pending client confirmation | *(separation columns after BC)* |

---

## Gap Notes

### Gap 1 — Dual Lookup (col M: Employment Status)
The masterlist uses one column for values that belong to two different DB tables:
- `tbl_employment_type`: Regular, Probationary, Contractual
- `tbl_employee_status`: Active, Resigned, Terminated, AWOL, Retired

Both `field_employment_type` and `field_employee_status` point to the same Excel column header in the seed profile. The import engine resolves the raw value against both lookup tables independently. Terminal statuses (Resigned, Terminated, etc.) also set `is_active = FALSE` and flag `file_202_status = 'pending'` if separation data is absent.

### Gap 3 — Col T (Probationary End) — Validate-Only
No DB column exists or is needed. Engine reads col T, converts from Excel serial if numeric, then cross-checks against `date_hired + 180 days`. Discrepancy >5 days generates a warning. Value is never stored.

### Gap 4 — Excel Serial Dates
All columns tagged in `validation_rules.date_fields` are subject to auto-detection: if the raw cell value is numeric in range [25000, 60000], it is converted using the Windows Excel epoch (`(serial - 25569) × 86400 × 1000` ms). Every conversion is logged in the batch warning log.

### Gap 7 — Monthly Gross Pay (col AG) — Validate-Only
Cross-validates `AG == AE + AF` within ₱1.00 tolerance. Discrepancy generates a warning row on `tbl_import_batch`. Import proceeds regardless.

### Gap 8 — Daily Rate (col AH) — Back-Calculate or Validate
If `basic_salary` (col AE) is blank for that row: `basic_salary = AH × pay_factor`; `pay_class` overridden to `Daily-paid`.  
If `basic_salary` is present: cross-validate within 5% tolerance; flag if exceeded.  
Value never stored as a separate column.

### Coverage Date Header Ambiguity (cols AA, AC)
Both labeled "Coverage Date" — indistinguishable by header string alone. Engine uses positional resolution: the Coverage Date immediately following a Position column is associated with that position. See `004_import_map_patches.sql` for the positional algorithm note.

### Separation Columns (cols BD+)
The client has a separate sheet for separated employees and may also have additional columns after BC. Field mappings are added to `tbl_import_column_map` but values in the seed profile are NULL until the client confirms the column headers and sheet name.
