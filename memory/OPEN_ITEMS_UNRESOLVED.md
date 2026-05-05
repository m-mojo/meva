# MINERVA — Open Items: Unresolved / Pending Client Decision

> Last updated: 2026-04-27
> Source: OPEN_ITEMS.md, OPEN_ITEMS_RESPONSE.txt, and conversation decisions.
> Items here are either awaiting client clarification, awaiting file delivery, or have no finalized design yet.
> Cross-reference with CONTEXT_SUMMARY_UNO.md and CLAUDE.md for resolved decisions.

---

## LEGEND

| Tag | Meaning |
|---|---|
| `[AWAITING CLIENT]` | Client has not made a decision yet; must raise in next meeting |
| `[AWAITING FILE]` | User has committed to providing a reference file or document |
| `[AWAITING DESIGN]` | Feature is approved; implementation approach not yet decided |
| `[LEGAL REVIEW]` | Intersects with Philippine labor law; confirm with legal or DOLE |
| `[CLARIFY]` | Statement/requirement is ambiguous; needs rephrasing or confirmation |

---

## 1. Training Period / Probation / Employment Timeline

**Tag:** `[AWAITING CLIENT]` — partially resolved 2026-04-28

**Source:** OPEN_ITEMS_RESPONSE.txt item 6

**What was confirmed (2026-04-28):** The client uses a 3-step lifecycle:
- On Training (16 days) → Probationary (6 months) → Regular
- Each transition requires HR Admin approval (UI action; no separate form)
- Schema patched in `005_lookup_seeds.sql`: promoted_by/promoted_at on history, TRAINING_ENDING trigger, training_ending_reminder_days on punch_config

**What is still unresolved:**
- Does probationary employment affect timekeeping computation? (e.g., different pay rate or leave accrual vs regular?)
- How does a mid-probation termination affect leave balance cashout?
- Is `Contractual` an employment type the client actually uses? `Project-based` confirmed and seeded. (seeded in 005 but unconfirmed for Contractual)

**Raise to client:** "During the training and probationary periods, do employees earn leave credits? Is their pay rate different from regular employees?"

---

## 2. DOD No-Show — Rest Day or Absence?

**Tag:** `[AWAITING CLIENT]` `[LEGAL REVIEW]`

**Source:** OPEN_ITEMS_RESPONSE.txt item 18; conversation notes

**What was decided:** HR reviews it; unresolved.

**What is still unresolved:**
- If an employee is assigned a DOD (Day-Off with Duty) in the schedule but does not show up — should the system classify it as a rest day (restored) or an absence?
- Philippine law: a rest day that is converted to a work day but the employee does not report — is the employee liable for an absence, or does the employer's failure to enforce it revert it back to a rest day?
- Who can change a DOD-flagged cell to absent after the fact? Only HR Admin?
- Does this trigger a leave deduction or an absence deduction?

**Raise to client:** "If an employee is assigned DOD but does not show up, do you want the system to treat that as an absence (salary deduction) or a rest day (no deduction)? What does your current practice say?"

**Developer note:** For now, a DOD with no punch-in should create a timekeeping row with `anomaly_flag = TRUE` and `classification_status = 'manual_review'`. HR Admin resolves manually. Do not auto-classify.

---

## 3. Mid-Cutoff New Hire — Default Behavior

**Tag:** `[AWAITING CLIENT]`

**Source:** OPEN_ITEMS.md Part 4; conversation

**What was decided:** Make it configurable. No default selected.

**What is still unresolved:**
- What should happen when a new employee is hired mid-cutoff?
  - Option A: Prorate — count only days from `date_hired` to cutoff end.
  - Option B: Full cutoff — first cutoff always starts from the first day of the cutoff period, even if hired mid-way.
  - Option C: Next cutoff — new employee's first timekeeping cycle starts at the next full cutoff.
- Does the client want a configuration toggle per company or per employee?
- Who sets this — Super Admin or HR Admin?

**Raise to client:** "When a new employee starts, say on the 5th of a cutoff period (26th–10th), do you want their timekeeping to start from the 26th or from the actual start date?"

---

## 4. Admin Role — Module Access Matrix

**Tag:** `[AWAITING DESIGN]`

**Source:** OPEN_ITEMS_RESPONSE.txt item 9

**What was decided:** Admin gets a Payroll Data View tab. This applies to both Admin and HR roles. Approved — schema must support it. User wants more ideas and the concept is "not fleshed out."

**What is still unresolved:**
- What exactly does the Admin role see vs the HR role?
  - HR Admin: Full CRUD on employees, full timekeeping + leave management, approve forms, publish schedule
  - Admin: View-only? Or can they export reports?
- Specific modules for Admin:
  - Timekeeping summary per cutoff — view only?
  - Payroll Data View tab — what fields does this include? (Net hours? Computed pay? Deductions?)
  - Can Admin export to Excel/PDF?
  - Can Admin see individual employee salary rates? Or only totals?
- The "Payroll Data View" tab concept needs fleshing out:
  - Does it show a per-employee, per-cutoff table?
  - Should it show a breakdown (gross / deductions / net) or just a summary?
  - Should it include a column for each deduction type (late, undertime, break, etc.)?
  - Should it be accessible only within a date range filter?

**Developer note:** Schema already has `tbl_user_scope` for per-subdept access. Payroll data columns will need to come from `tbl_timekeeping` + `tbl_deduction` + `tbl_additional` aggregated per employee per cutoff. No new tables needed — this is a query/view concern.

---

## 5. Biometric Device Name — Reconciliation UI Design

**Tag:** `[AWAITING DESIGN]`

**Source:** OPEN_ITEMS_RESPONSE.txt item 7

**What was decided:** Add `biometric_name` column to `tbl_employees` (for the name stored on the device). Use it as Tier 2 matching in reconciliation. A UI where Minerva users can manually match device names to employees was requested. Possibly integrated into an existing reconciliation tab.

**What is still unresolved:**
- Does a dedicated reconciliation page exist already in the frontend? (If yes, should the device name matching be a tab on it? If no, where does it live?)
- UI design for the matching interface:
  - Option A: A two-column table — left = unmatched device names, right = employee dropdown to assign
  - Option B: A side-by-side view — device roster on one side, MINERVA employee list on the other; drag-to-match or select-to-link
  - Option C: A review queue — only unresolved punches are shown, with a "match to employee" action inline
- Who can use this UI? IT Admin only? Or also HR Admin?
- After a device name is matched, does it auto-update `tbl_employees.biometric_name`? Or does it go through an approval step?
- Does this generate an audit log entry?

**Developer note:** `tbl_biometric_uid_change_log` (P7) handles UID auditing. `tbl_biometric_name_change_log` (NT2) has been added to `002_patches.sql` Section 13 — mirrors UID log structure; VARCHAR(100) for old_name/new_name; includes FK on `changed_by` to tbl_user_account.

---

## 6. Payroll Data View — Full Design

**Tag:** `[AWAITING DESIGN]`

**Source:** OPEN_ITEMS_RESPONSE.txt item 9 and 10

**What was decided:** Payroll Data View is for both Admin and HR roles. It should appear at the employee info tab and summary. Service charges and 13th month are optional and configurable, not dropped.

**What is still unresolved:**
- What columns does the Payroll Data View table contain per row?
  - Suggested minimum: Employee name, Cutoff period, Regular hours, OT hours, ND hours, Late (hrs/mins), Undertime (hrs/mins), Break deduction, DOD, Gross pay, Deductions total, Net pay
  - Optional additions: Leave used, Leave balance, Service charge share, 13th month accrued
- Does it show per-employee rows or per-subdept aggregates?
- Filter options: by cutoff? by subdept? by employee?
- Export as PDF and Excel — what should the header look like? Company logo? Period?
- Should it support a "finalize cutoff" action (lock the period from further edits)?
- What is the difference between what HR Admin sees and what Admin sees on this tab?

---

## 7. ND (Night Differential) Break Checkbox — Julie Inclusion

**Tag:** `[AWAITING CLIENT]`

**Source:** OPEN_ITEMS_RESPONSE.txt item 11

**What was decided for MINERVA:** `has_break` is a coordinator-toggled checkbox per shift assignment at roster drafting. Default: >9 hours = has break, ≤8 hours = no break. But coordinator can override either way.

**What is still unresolved:**
- Should this same checkbox mechanic be kept for Julie (the future SaaS version)?
  - User asked: "obviously, this is only for Minerva but should we keep it for Julie?"
  - No answer recorded — pending decision.

**Developer note:** Since `has_break` is a column on `tbl_shift` and toggled at shift preset creation, it naturally carries to any future tenant in Julie. No special work required. The question is whether Julie's HR rules or client SLAs might force the field to behave differently.

---

## 8. Multiple Schedule Types on Same Date (sched_type conflict)

**Tag:** `[AWAITING CLIENT]`

**Source:** OPEN_ITEMS_RESPONSE.txt item 17

**What was decided:** User said "I really don't think this will occur so drop." But the question was: what if it does arise?

**What is still unresolved:**
- If the need to display multiple `sched_type` values on the same cell arises (e.g., `dod` + `regot` simultaneously), what should the system display?
- Current design: `tbl_schedule.sched_type` is a single ENUM for display; `tbl_schedule_date_annotation` handles multiple computation flags on the same date.
- For now: treat as edge case, do not build UI for it. But document the fallback:
  - If a date has both `dod` and `regot` annotations, the cell displays `sched_type` from `tbl_schedule` (primary label) and the annotation table carries the secondary computation flag.
  - If an HR Admin needs to manually set both, they would use the override form, not the grid cell.

**Developer note:** This is a design decision only if the client encounters it in practice. For MVP, `tbl_schedule_date_annotation` handles the multi-flag case at computation. Grid display remains single `sched_type`.

---

## 9. Issue 7 — Same Cutoff Start/End Dates for Both Companies

**Tag:** `[CLARIFY]`

**Source:** OPEN_ITEMS_RESPONSE.txt item 28 (issue 7)

**User response:** "client has the same starting date and ending date for both companies. under Minerva, consider this and provide a good resolution. what do you mean anyway"

**What this issue referred to originally:**
The question was: what happens if UTH and SSH have different cutoff periods? The `tbl_cutoff_period` table has a `UNIQUE KEY uq_cutoff_company_start (company_id, start_date)` which means each company can have its own cutoff schedule.

**Implication:** Since the client confirmed both companies share the same cutoff dates, the unique key is redundant for them. But the schema still supports independent cutoffs per company — this is correct for Julie.

**What is still unresolved:**
- Is there a business rule that says both companies MUST always have the same cutoff dates, or is this just the current client's practice?
- If a Minerva admin creates a cutoff period, should it auto-create it for both companies simultaneously? Or separately?
- If one company's cutoff is closed and the other's is still open, does that create any cross-company payroll issues?

**Developer note:** For MVP, assume both companies always share cutoff dates. No auto-sync logic needed. Schema is already correct for independent cutoffs if needed later.

---

## 10. Algorithm Reference Files — Timekeeping

**Tag:** `[AWAITING FILE]`

**Source:** OPEN_ITEMS_RESPONSE.txt item 15; OPEN_ITEMS_RESPONSE.txt item 36

**What was decided:** User will provide the algorithm reference file later. Once received, provide UX and implementation suggestions.

**Files still to be provided:**
- Timekeeping comparison algorithm reference (from old build)
- Roster management and shift creation flow (for the broken/flexible schedule — referenced in issue 1 response)
- Biometric device bridge reference files (for reverse-engineering the hardware integration)
- Excel masterlist file (for column header mapping to `tbl_employees`)
- Module map and build timeline document

**Developer note:** Do not finalize the timekeeping computation engine or the biometric bridge implementation until these files are received. CONTEXT_SUMMARY_UNO.md Issue 15 is the current working reference for the algorithm.

---

## 11. Flexible / Broken Schedule Flow — Continuation

**Tag:** `[AWAITING FILE]`

**Source:** OPEN_ITEMS_RESPONSE.txt item 22 (issue 1)

**What was decided:** The user has an old implementation of the flexible/broken schedule (called "continuation" or "split shift"). They will attach the full flow from roster management and shift creation to validation of work time rendered to assigned schedule.

**What is still unresolved:**
- The exact UI flow for setting a continuation shift in the roster grid is not yet confirmed.
- The computation rules for continuation shifts when the second segment times differ from the preset (`flex_time_in` / `flex_time_out` override fields) are not fully tested.
- The 14-hour reset rule exemption for split shifts — the exact detection logic has been documented (`check if continuation_shift_id is set on that day's schedule`) but not yet validated against the old implementation.

---

## 12. Issue 2 — Significance Not Yet Explained

**Tag:** `[CLARIFY]`

**Source:** OPEN_ITEMS_RESPONSE.txt item 23 (issue 2)

**User response:** "elaborate on this as i do not understand significance of this for the project. enlighten me"

**The response to this has not been given yet.** The explanation of Issue 2's significance (from OPEN_ITEMS.md) is pending. This needs to be addressed before the relevant schema/implementation work proceeds.

**Action:** Retrieve OPEN_ITEMS.md Issue 2 and provide the elaboration.

---

## 13. Operations Head Sign-Off — UI Flow

**Tag:** `[AWAITING DESIGN]`

**Source:** Conversation decisions; OPEN_ITEMS_RESPONSE.txt item 8

**What was decided:** Operations Head sign-off (`noted_by_user_id` + `noted_at`) is a **hard workflow step** between coordinator submission and HR Admin publication. Schema patch applied.

**What is still unresolved:**
- What does the Operations Head's UI look like?
  - Do they see the full roster grid in read-only mode?
  - Is there a dedicated "pending endorsements" queue?
  - Can they partially endorse (approve some subdepts but not others)?
  - Can they return the schedule to the coordinator with comments?
- What notification is sent when a coordinator submits for Operations Head review?
- What notification is sent to HR Admin after Operations Head signs off?
- Is the Operations Head a separate role in `tbl_user_account.role` ENUM, or is it the `coord` role with elevated scope?

---

## 14. Schedule Grid — Position Label Display on Cells

**Tag:** `[AWAITING CLIENT]`

**What is still unresolved:**
- Should individual roster grid cells show the employee's position label (e.g., FDA, FDB, Housekeeper)?
- Or is the position label only shown on the row header?
- This affects cell height and grid density — important for coordinator UX.

---

## 15. Issue 7 Open Items — biometric_name Column and Reconciliation Tab

**Tag:** `[AWAITING DESIGN]`

**Source:** OPEN_ITEMS_RESPONSE.txt item 7

**What was approved:**
- Add `biometric_name` column to `tbl_employees` (device-stored name)
- Consider a UI for HR/IT to match device names to employee records
- Possibly a reconciliation page or tab

**Best suggestions (pending user decision):**

**Option A — Inline on Employee Profile:**
Add a "Biometric" section to the employee detail page. Shows `biometric_device_uid` and `biometric_name`. IT Admin can edit. Simple, no new page needed.

**Option B — Standalone Reconciliation Page:**
A dedicated page at `/reconciliation` (or a tab on the Devices page). Shows all unresolved and fixable biometric entries. Two panels: left = device users (name + UID), right = MINERVA employees. IT Admin selects a device user and links it to an employee. Generates `tbl_biometric_uid_change_log` entry.

**Option C — Review Queue (recommended for MVP):**
Only shows up when there are unresolved punches. A badge/notification in the sidebar alerts IT Admin. Clicking opens a modal or page showing: device name, last punch time, "Assign to employee" dropdown. After assignment, system re-processes queued punches for that device_user_id.

**User has not chosen an option.** Raise before building the reconciliation UI.

---

## 16. Graveyard Break Deduction — Default Confirmation

**Tag:** `[AWAITING CLIENT]`

**Source:** Conversation; schema patch 2

**What was decided:** `break_applies_to_graveyard` defaults to `FALSE` in schema. Configurable per company via `tbl_computation_rules`. Coordinator can also set `has_break` at roster drafting level.

**What is still unresolved:**
- Has the client confirmed that graveyard shifts at their hotel do NOT have break deductions by default?
- Is there a specific shift (e.g., 10PM–6AM) that should or should not have this flag set?

**Raise to client:** "For overnight or graveyard shifts — do you currently deduct break time from those employees' hours or not?"

---

## 17. Import — Employment Status Dual-Lookup Seeding

**Tag:** `[AWAITING DESIGN]`

**Source:** Masterlist gap analysis — Gap 1 / session decision 2026-04-28

**What was decided:** The correct approach is to seed `tbl_employment_type` and `tbl_employee_status` with Minerva's specific vocabulary. The import engine resolves col M's raw string against these two tables via case-insensitive lookup. For Julie, additional rows are inserted per client — the engine does not change. This is confirmed as the right approach.

**Column names to match against:**
- `tbl_employment_type.employment_type` (VARCHAR 60)
- `tbl_employee_status.employment_status` (VARCHAR 60)

**Seeding still needed:** Neither table has seed data yet (003 only seeds punch/rate config). Add an `INSERT` block for both tables in `005_lookup_seeds.sql` before running the import.

**Known Minerva vocabulary (from CONTEXT_SUMMARY_UNO.md):**
- Employment types: `Regular`, `Probationary`, `Contractual` *(confirm Project-based with client)*
- Employee statuses: `Active`, `Probationary`, `On Training`, `On Leave`, `Suspended`, `AWOL`, `Resigned`, `Terminated`, `Retired`, `Separated`, `Death`

**What is still unresolved:**
- What does the client actually write in col M for inactive employees? Once the full file is provided, cross-check raw values against the seeded vocabulary. If any value produces no match → hard error on that row; add to batch error log.

---

## ITEMS TO RAISE AT NEXT CLIENT MEETING

Priority order:

1. DOD no-show policy (rest day restored or absence?) — legal + operational
2. Training/probation period — employment types, rates during probation
3. Mid-cutoff new hire — prorate or next cutoff?
4. Graveyard break deduction default confirmation
5. Payroll Data View — what columns, what each role sees
6. Operations Head role — is it a role in the system or an external person who signs off on paper?
7. Import lookup seeding — cross-check col M values against seeded vocabulary once full masterlist file is available

---

## FILES THE USER WILL PROVIDE (do not finalize implementation until received)

| File | Purpose |
|---|---|
| Full masterlist file (not sample) | Cross-check col M values against seeded lookup vocabulary; confirm separation sheet structure |
| Biometric bridge reference | Reverse-engineer device communication (HTML mock to be built for phone testing) |
| Timekeeping algorithm reference | Validate computation engine against old build |
| Flexible/broken schedule flow | Roster UI flow for continuation shifts |
| Module map + build timeline | Adjust scope and MVP priorities |

---

*This file is a living document. Update it when client decisions are confirmed. Move resolved items to CONTEXT_SUMMARY_UNO.md.*
