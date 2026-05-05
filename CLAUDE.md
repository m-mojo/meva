# MINERVA – HRIS Bridge

## PROJECT DOMAIN

Internal HRIS system for a two-company hotel group in the Philippines (UTH + SSH).
Covers biometric attendance capture → timekeeping computation → payroll-ready output.
Governed by Philippine labor law (DOLE). Single deployment, on-premise hotel server.

Full schema and requirements: `reference/CONTEXT_SUMMARY_UNO.md` (authoritative reference).
Edge cases and client decisions: `memory/OPEN_ITEMS.md` + `memory/OPEN_ITEMS_RESPONSE.txt`.
Schedule/shift UI flow: `reference/SHIFTS_SCHEDULES_FLOW.txt`.

---

## SCALE

| Dimension | Value | Notes |
|---|---|---|
| Active employees | ~70 | Across both companies (UTH + SSH) |
| Companies | 2 | Shared DB, discriminated by `company_id` |
| Concurrent users | Plan for 20 | 5 roles; low-traffic internal tool |
| Biometric devices | 2 | ZKTeco UF100, one per company |
| Peak punch rate | ~20–30/5 min | Shift change window |
| Raw log volume | ~150+ punches/day (edge: 250) | 70 employees × 2 punches; peak shift-change bursts |
| Timekeeping records | ~2,100/cutoff | 70 employees × 15 days + OT rows |
| Reports cadence | Every 15 days | Aligned to cutoff cycle |
| DB growth | Low | Append-only logs; 7-year retention |

At this scale a single MySQL instance on a mid-spec server (4 cores, 8 GB RAM) handles
everything comfortably. No replication required initially.

---

## TECH STACK

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js (latest LTS) | Async I/O, good ZK lib support |
| Framework | Express 5 | REST API only; no logic in routes |
| Database | MySQL 8.0 (InnoDB, utf8mb4) | Single instance, on-premise |
| DB driver | mysql2 | Promise-based, connection pool |
| Frontend | Vanilla HTML/CSS/JS | SPA with hash-based routing; no framework (preference, not hard rule) |
| Auth | JWT | Stored as `hris_token` + `hris_role` in localStorage |
| Real-time | socket.io | Biometric feed + in-app notifications |
| Biometric bridge | node-zklib | TCP connection to ZKTeco UF100 |
| Report export | PDFKit (PDF) + ExcelJS (Excel) | Both formats required |
| Deployment | On-premise, hotel server | Linux preferred; no Docker requirement |

### Notifications (MVP)

Socket.io in-memory broadcast only — free, zero setup, already proven.
Max 50 notifications kept in memory per event type.
No email or SMS for MVP; wire those post-MVP through `tbl_notification_config`.

---

## NPM DEPENDENCIES

Exact packages from the reference implementation:

```json
{
  "express": "^5.2.1",
  "mysql2": "^3.20.0",
  "socket.io": "^4.8.3",
  "node-zklib": "^1.3.0",
  "bcryptjs": "^3.0.3",
  "jsonwebtoken": "latest",
  "cors": "^2.8.6",
  "dotenv": "^17.3.1",
  "body-parser": "^2.2.2",
  "pdfkit": "latest",
  "exceljs": "latest"
}
```

---

## ENVIRONMENT VARIABLES

```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=minerva_hris_db
PORT=3000
JWT_SECRET=
DEVICE_IP_UTH=
DEVICE_IP_SSH=
DEVICE_PORT=4370
DEVICE_SERIAL_UTH=
DEVICE_SERIAL_SSH=
```

---

## FILE STRUCTURE

```
minerva/
├── src/
│   ├── app.js                   ← Express factory (no server.listen here)
│   ├── server.js                ← Entry point; PM2 runs this; starts HTTP + socket.io
│   ├── config/
│   │   ├── env.js               ← Validates all env vars on startup; exports typed config object
│   │   └── db.js                ← MySQL pool + queryWithRetry; only file that calls process.env for DB
│   ├── device/                  ← All device communication; nothing outside this folder talks to hardware
│   │   ├── adms.js              ← ADMS push endpoints (/iclock/*); mounted before auth middleware
│   │   ├── sync.js              ← 10s ZKLib pull loop; calls direction.js before every insert
│   │   ├── direction.js         ← resolveLogType() — 5-rule algorithm; no DB writes, returns direction only
│   │   └── adapters/
│   │       └── uf100.js         ← ZKLib TCP wrapper for UF100; add uf200.js here for new hardware
│   ├── middleware/
│   │   ├── auth.js              ← JWT verify → attaches req.user { user_id, role, company_id, sub_dept_access }
│   │   ├── scope.js             ← Subdept access guard; reads req.user.sub_dept_access; 403 on violation
│   │   └── audit.js             ← Appends to tbl_audit_log after every write; never throws
│   ├── routes/                  ← HTTP layer only; validate input, call service, return response
│   │   ├── index.js             ← Mounts all routers onto app
│   │   ├── auth.js
│   │   ├── employees.js
│   │   ├── schedule.js
│   │   ├── timekeeping.js
│   │   ├── leave.js
│   │   ├── requests.js
│   │   ├── devices.js
│   │   └── reports.js
│   ├── services/                ← All business logic; signature is always (params, ctx)
│   │   ├── auth.js
│   │   ├── employees.js
│   │   ├── schedule.js
│   │   ├── timekeeping.js
│   │   ├── leave.js
│   │   ├── reconciliation.js
│   │   ├── requests.js
│   │   └── reports.js
│   ├── db/
│   │   └── queries/             ← SQL only; company_id is always a required param
│   │       ├── employees.js
│   │       ├── schedule.js
│   │       ├── timekeeping.js
│   │       ├── leave.js
│   │       ├── devices.js
│   │       ├── requests.js
│   │       └── reports.js
│   └── notifications/
│       └── bus.js               ← socket.io broadcast + 50-item in-memory ring buffer
├── public/
│   ├── pages/                   ← HTML files; not dumped at root
│   ├── js/                      ← One JS file per page
│   ├── css/                     ← One CSS file per page
│   └── resources/               ← Static assets (logo, fonts, etc.)
├── migrations/                  ← Numbered SQL files: 001_init.sql, 002_add_column.sql
├── scripts/                     ← One-off admin ops: seed.js, bootstrap-user.js, recompute-direction.js
├── .env
├── .env.example
├── package.json
└── nodemon.json
```

### ctx — the Julie extension point

Every service receives a `ctx` object built by `middleware/auth.js`. Today it carries:
```javascript
ctx = { company_id, user_id, role, sub_dept_access }
```
When Julie requires multi-tenancy, middleware injects `tenant_id` and all queries add a tenant filter — no service rewrites needed. All `db/queries/` files already require `company_id` as a param, making `tenant_id` an additive change.

### What lives where — hard rules

- `device/` never imports from `services/` or `routes/`. Data flows one way: hardware → direction.js → raw insert.
- `routes/` never imports from `db/queries/` directly. Always goes through a service.
- `services/` never touches `req` or `res`. No Express objects past the route layer.
- `config/env.js` is the only file that reads `process.env`. Everything else imports from config.

---

## HARD CONSTRAINTS

- **Never modify raw device logs after insert.** `tbl_raw_device_logs` is append-only truth layer.
- **Compute punch direction (C/In / C/Out) before insert,** not on read. Device state is untrusted.
- **No business logic in routes.** Services handle logic; queries handle SQL only.
- **No hard deletes anywhere.** All deactivation via `is_active` flag.
- **No ON DELETE CASCADE** on any FK. Soft deactivation only.
- **Monetary values always `DECIMAL(10,2)`.** Never INT or FLOAT.
- **Audit log is append-only.** REVOKE UPDATE/DELETE on `tbl_audit_log` at DB level.
- **Every device must have a unique `device_id`.** No shared identity across devices.
- **Do not auto-create employees** during biometric reconciliation. Unknown = flag, not guess.

---

## SOFT CONSTRAINTS (preferences, not rules)

- async/await only — no callbacks
- camelCase throughout
- Small, single-purpose functions
- Vanilla JS frontend — only escalate to a framework if complexity genuinely demands it

---

## ARCHITECTURE

```
ZKTeco UF100 (TCP)
  → src/device/sync.js          (ZKLib pull, every 10s)
  → src/device/adms.js          (ADMS push, /iclock/*)
    → src/device/direction.js   (resolveLogType — 5-rule algorithm)
      → tbl_raw_device_logs     (append-only, never updated)
        → src/services/reconciliation.js
          → tbl_timekeeping
            → tbl_deduction + tbl_additional
              → src/routes/     (REST API via Express)
                → middleware/auth.js + scope.js + audit.js
                  → public/     (Frontend SPA, vanilla JS)
```

### Layer responsibilities

| Layer | Responsibility |
|---|---|
| `src/device/` | All hardware communication; isolated; no imports from services or routes |
| `src/middleware/` | Auth (JWT), subdept scope guard, audit log writer — composable, not inline |
| `src/routes/` | HTTP only — parse input, call service with ctx, return response |
| `src/services/` | All business logic — receives (params, ctx), never touches req/res |
| `src/db/queries/` | SQL only — no conditionals beyond query building; company_id always required |
| `src/config/` | Env validation + DB pool — single source; nothing else reads process.env |

---

## DB CONNECTION CONVENTIONS

```javascript
// db.js — use this exact pattern
const pool = mysql.createPool({
  host:               process.env.DB_HOST,
  port:               process.env.DB_PORT     || 3306,
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME,
  timezone:           '+08:00',           // Asia/Manila — always explicit
  waitForConnections: true,
  connectionLimit:    20,
  queueLimit:         0,
  enableKeepAlive:    true,
  keepAliveInitialDelay: 0
});

// Force timezone on every new connection
pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+08:00'");
});

// Wrap every query in this; handles dropped connections gracefully
async function queryWithRetry(sql, params = [], retries = 3, delay = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      const retryable = ['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED', 'ER_CON_COUNT_ERROR'];
      if (retryable.includes(err.code) && i < retries - 1) {
        await new Promise(r => setTimeout(r, delay));
        delay *= 2;
      } else throw err;
    }
  }
}
```

---

## PUNCH DIRECTION ALGORITHM

**File:** `src/device/direction.js → resolveLogType(device_user_id, currentTime)`

The device's raw `state` field is untrusted and preserved as-is in `tbl_raw_device_logs.state`.
The computed direction is written to `new_state` (values: `C/In` or `C/Out`) before insert.
Nothing downstream reads the raw `state` column. Only `new_state` drives timekeeping.

Rules applied in strict order:

| # | Condition | Result |
|---|---|---|
| 1 | No previous punch on record for this employee | `C/In`, shift_date = today |
| 2 | Last punch < `duplicate_punch_window_seconds` ago (default 60s) | `null` — skip insert entirely |
| 3 | Last punch was `C/In` AND last `shift_date` was yesterday AND that shift has `crosses_midnight = TRUE` | `C/Out`, shift_date = yesterday (overnight completion) |
| 4 | Last punch > 14 hours ago | Force `C/In`, shift_date = today (reset) |
| 5 | Default | Toggle: `C/In` → `C/Out` → `C/In` |

Both the 60-second duplicate window and 14-hour reset threshold live in `tbl_computation_rules`
and must be fetched per `company_id` — never hardcoded.

`shift_date` (not `record_time` date) is what binds a punch to a schedule row.
Cross-midnight punches for overnight shifts must carry the previous day's date as `shift_date`.

### Reconciliation — Three-Tier Matching

Before direction can be computed, `device_user_id` must be resolved to an `employee_id`.
Matching strategy is configured in `tbl_computation_rules.biometric_matching_strategy`:

| Tier | Match attempt |
|---|---|
| 1 | `device_user_id` → `tbl_employees.biometric_device_uid` (primary key match) |
| 2 | `employee_name_raw` → `tbl_employees.biometric_name` (fallback name match) |
| 3 | Last 3 digits of `employee_number` → `device_user_id` (Minerva-specific) |

If no tier resolves: set `reconciliation_status = 'unresolved'` and notify IT Admin.
**Never auto-create employees. Never guess. Unresolved = flag and stop.**

### Split Shift Punch Pairs

For employees with a continuation shift (`continuation_shift_id` set on `tbl_schedule`):
- Punches 1 + 2 = primary segment (C/In, C/Out)
- Punches 3 + 4 = continuation segment (C/In, C/Out)
- Each pair maps to a `tbl_timekeeping` row with `segment_order = 1` and `segment_order = 2`
- The 14-hour reset (rule 4) must not fire between segments of a split shift — check if a
  continuation shift exists for that employee's schedule before applying the reset

### Edge Cases

| Scenario | Handling |
|---|---|
| **Early OT** | punch_in arrives earlier than `sched_in − early_ot_threshold_minutes`. OT hours are computed and credited regardless (PH law: employer must pay if work was performed). A form must be submitted. Without a form: `ot_approval_status = 'flagged_no_form'`, notify HR Admin for verification. HR reviews and approves or adjusts — does not block computation. |
| **Late OT** | punch_out exceeds `sched_out + late_ot_threshold_minutes`. Same rule as Early OT — form required, flagged without one, OT still credited, HR Admin notified and reviews. |
| **Near-window punch (outside schedule, no form)** | Punch falls outside the schedule window but within a configurable tolerance. Not auto-classified as OT. `anomaly_flag = TRUE`. HR Admin reviews: if confirmed regular attendance, rounded to on-time; if confirmed OT, form must be submitted. Rounding only happens after HR verification — never automatic. |
| **Missed punch** | Only one of the pair arrives. Detected after `missed_punch_detection_buffer_minutes` with no matching partner. `anomaly_flag = TRUE`, `classification_status = 'manual_review'`, fire `MISSED_PUNCH_DETECTED` notification to HR Admin. |
| **Missed continuation punch** | Primary segment (punches 1+2) completed but continuation C/In never arrives after the expected gap. Flag `anomaly_flag = TRUE` on the `segment_order = 2` row only. `MISSED_PUNCH_DETECTED` fired for the continuation segment. Does not invalidate the primary segment. |
| **Ghost punch / AWOL return** | Rapid succession punch that doesn't fit the direction pattern. `anomaly_flag = TRUE`, `supervisor_verified` attestation required before timekeeping is computed. |
| **Meal break abuse** | `has_break` is toggled per shift by the coordinator during schedule drafting (not a global setting). Auto-deduct `break_deduct_hours` when `total_hours_day > break_deduct_threshold_hours` AND `has_break = TRUE`. For graveyard shifts: deduction applies only if `break_applies_to_graveyard = TRUE` on `tbl_computation_rules` (default FALSE). |
| **OT without form** | Recognized and credited. `ot_approval_status = 'flagged_no_form'`. Notify HR Admin. HR reviews — does not block the OT from being computed. PH law: employer must pay OT if work was actually performed regardless of form. |
| **Pre-employment punch** | `record_time < tbl_employees.date_hired`. Reject insert. `reconciliation_status = 'unresolvable'`. Notify IT Admin. |
| **Post-separation punch** | `record_time > tbl_employees.date_separated`. `anomaly_flag = TRUE`. Notify IT Admin and HR. Do not auto-reject — device may not be updated yet. HR reviews. |
| **Leave day punch** | Punch arrives on a date where `tbl_schedule.sched_type = 'on_leave'`. `anomaly_flag = TRUE`. Notify HR Admin — employee may have cancelled leave or punched the wrong device. HR decides: honour leave or reclassify. |
| **Cross-device punch** | Employee punches on the wrong company's device. `device_id` does not match employee's `company_id`. Flag `reconciliation_status = 'unresolvable'`, note: "wrong device". |
| **Device clock drift** | Punch timestamps significantly off from server time (detectable via heartbeat delta). Flag all punches in that batch with a `reconciliation_note`. IT Admin corrects device clock. |
| **Device memory full / log gap** | ZKTeco memory fills; oldest records overwritten before sync. If `last_stamp` shows a gap on reconnect, flag affected sync window with a `device_sync_gap` note. IT Admin investigates. Lost punches cannot be recovered — manual override required per affected employee. |
| **Bulk sync after offline period** | Device was offline, then reconnects and dumps backlog. Always sort by `record_time ASC` before processing — never process in insertion order. Direction algorithm depends on chronological sequence. |
| **Schedule-less punch (unplanned DOD)** | Employee is OFF per schedule but punches in. No schedule row to compare against. Create `tbl_timekeeping` row with `schedule_id = NULL`, `classification_status = 'unclassified'`, `anomaly_flag = TRUE`. HR reviews — if confirmed DOD, manually sets `day_scenario` and triggers recomputation. |
| **Orphaned C/In (no punch-out)** | Shift ends, >14 hours pass, no C/Out ever recorded. Rule 4 fires on next punch (force C/In reset). Also fire `MISSED_PUNCH_DETECTED` for the orphaned C/In. Flag timekeeping row as `manual_review`. |
| **Double C/In or Double C/Out** | Two consecutive punches of the same direction (direction algorithm bug or device error). Detected during timekeeping punch-pairing. `anomaly_flag = TRUE`. HR reviews. |
| **Retroactive schedule change** | HR modifies a published schedule row after punches have already been processed and `tbl_timekeeping` rows exist. Existing timekeeping rows are now stale. A recomputation job must be triggered for the affected employee + date range. Audit log must record who changed it and why. |
| **Retroactive holiday addition** | A `tbl_holiday` row is added for a past date after timekeeping was already computed. `day_scenario` on existing rows is now wrong. HR Admin triggers a targeted recomputation for all employees on that date. |
| **Employee transfer mid-cutoff** | Employee moved to a different subdept mid-cutoff. Their existing schedule rows belong to the old subdept/coordinator. The receiving coordinator cannot see or edit old rows. HR Admin must manually adjust post-transfer schedule rows. Flag the transfer date for HR attention. |

---

## SCHEDULE / ROSTER MANAGEMENT

Full flow: `SHIFTS_SCHEDULES_FLOW.txt` (authoritative for UI detail).

### Shift Slots (Replaced Blocks)

**Shift blocks (1ST/2ND/3RD/REL) are removed in v5.0.** They are replaced by `tbl_shift_slot`.

- Each subdepartment defines its own named slots (`slot_label`) with a display order (`slot_order`)
- `slot_order` controls left-to-right column position on the grid. No computational meaning.
- Reliever slots use `is_reliever = TRUE` on `tbl_shift_slot` — no separate block concept
- Slot names are unique per subdepartment: `UNIQUE KEY uq_slot_label_subdept`
- The roster grid column header shows `slot_label` (e.g., "Breakfast", "Restobar", "Reliever")
- `tbl_schedule.slot_id` is the FK — this is how a schedule row is tied to a column

### Shift Presets (`tbl_shift`)

- Global preset library; no limit on number of presets
- `shift_name` is globally unique (`UNIQUE KEY uq_shift_name`)
- `crosses_midnight` auto-detected when `time_out < time_in`
- `has_break` is set by the coordinator at schedule drafting. Default: shifts > 9 hours = has break;
  ≤ 8 hours = no break. But the coordinator can override either way.
- `is_graveyard` is set on the preset (schema patch v5.0). Computation engine reads this directly —
  no pool join required.
- `total_hours` is a MySQL VIRTUAL GENERATED column — never stored, always derived from
  `time_in` / `time_out` / `crosses_midnight`

### Cell States

| Status | Blocking (clears times) | Assignable | Notes |
|---|---|---|---|
| `off` | Yes | ✓ Coordinator | Rest day; max 1 per position per day (conflict check) |
| `absent` | Yes | ✓ Coordinator / HR | Unplanned absence |
| `on_leave` | Yes | ✓ HR (from approved leave) | Cascaded from leave approval |
| `dod` | No | ✓ Coordinator / HR | Day-off with duty; times optional; activates DOD computation |
| `regot` | No | ✓ Coordinator / HR | Regular OT; times optional |
| `changeoff` | No | ✓ Coordinator | Changed rest day |
| `fvl` | No | ✓ HR only | Forced Vacation Leave; HR-initiated |
| `absent_with_notice` | Yes | ✓ HR | Excused absence |
| *(flex)* | No | ✓ Coordinator | Dual/split shift; set via `flex_schedule = 1` + `flex_time_in/out` on same cell |

**HOLIDAY IS NOT AN ASSIGNABLE CELL STATUS.** Holidays are shown on the date column header
for coordinator guidance and used by the computation engine via `tbl_holiday`. A coordinator
never manually marks a cell as "holiday." If an employee works on a holiday, the
`day_scenario` in `tbl_timekeeping` detects it automatically from `tbl_holiday`.

**Rest day conflict rule:** Before setting `status = 'off'`, verify no other employee with the
same `position` in the same `subdepartment` is already OFF that day. Hard block with toast if
conflict found.

### Roster Grid — Data Model Per Cell

```javascript
cellData = {
  shift_id:             number | null,
  slot_id:              number | null,       // FK to tbl_shift_slot
  station_id:           number | null,       // F&B / Kitchen only
  time_in:              'HH:MM' | null,
  time_out:             'HH:MM' | null,
  crosses_midnight:     boolean,
  night_diff:           boolean,
  is_ot:                boolean,
  sched_type:           'off'|'absent'|'on_leave'|'regot'|'dod'|'changeoff'|'fvl'|'absent_with_notice'|null,
  is_rest_day:          boolean,
  flex_schedule:        0 | 1,
  continuation_shift_id: number | null,      // FK to tbl_shift (continuation preset)
  flex_time_in:         'HH:MM' | null,      // Override only — when continuation times differ from preset
  flex_time_out:        'HH:MM' | null,
  is_holiday:           boolean              // Read-only; derived from tbl_holiday, not user-set
}
```

### Publication Flow

**Drafting is always allowed while `schedule_state != 'locked'`** on `tbl_cutoff_schedule_status`.
There is no requirement to fill all employee cells before saving or publishing.

States per subdept (`tbl_cutoff_schedule_status.schedule_state`):

```
pending → open (drafting begins) → closing (soft deadline approaching) → locked
```

Publication steps:
1. Coordinator saves drafts freely (auto-save on change or explicit save — both supported)
2. Coordinator submits schedule → Operations Head reviews and signs off (`noted_by_user_id` + `noted_at`)
   — this is a **hard workflow step**, not optional
3. HR Admin publishes → `is_published = TRUE`, `publish_source = 'manual'`
4. After publish: coordinator is locked out of editing
5. HR Admin can still modify based on approved forms (OT, leave, shift swap, etc.)
6. **Schedules for the next cutoff must be published before that cutoff period starts.** Enforced.
   If not published in time, the system can auto-apply the previous cutoff's schedule
   (`publish_source = 'auto_previous'`) — but this is a fallback, not the expected path.

**Save-state (undo/redo):**
- Client-side: 50-state history (`undoStack` / `redoStack`), Ctrl+Z / Ctrl+Y
- Server-side: save draft at any point via `POST /api/schedules` — no validation gate on completeness

### Roster UX Improvements

- **Completeness indicator** — per-subdept progress bar (X/16 days filled) shown in header;
  advisory only, never blocks save or publish
- **Holiday highlighting** — date column headers are color-coded when a holiday falls on that date;
  tooltip shows holiday name
- **Previous cutoff copy** — option to copy prior cutoff's schedule as a starting point
- **Conflict badges** — small indicator on cells where rest-day conflict or anomaly exists
- **Quick keyboard navigation** — arrow keys move between cells; Enter opens context menu;
  Esc closes menus/modals
- **Row hover highlight** — entire employee row highlights on hover for easier cross-column reading
- **Slot filter** — toolbar dropdown to show only employees assigned to a specific slot column

---

## TIMEKEEPING COMPUTATION

### Algorithm (per employee per day)

Source: `OPEN_ITEMS.md` Issue 15 — authoritative algorithm reference.

```
1. Pull published schedule row (is_draft = FALSE) for employee + date
   For graveyard: also check date-1 for an open overnight C/In
2. Pull all C/In / C/Out pairs from tbl_raw_device_logs
   Filter: device_user_id matches AND shift_date = target date
   Sort: record_time ASC — always chronological
3. Pair punches:
     Pair 1 (segment_order=1): punch 1 (C/In) + punch 2 (C/Out)
     Pair 2 (segment_order=2): punch 3 (C/In) + punch 4 (C/Out) — continuation only
4. Compare each pair against scheduled_time_in / scheduled_time_out:
     punch_in < sched_in − early_ot_threshold_minutes
       → flag Early OT; recognized only with approved form; else flagged_no_form
     punch_in within [sched_in − early_ot_threshold, sched_in + grace_period]
       → On time
     punch_in > sched_in + grace_period
       → Late; compute late_minutes
     punch_out > sched_out + late_ot_threshold_minutes
       → flag Late OT; same form rule as Early OT
     punch_out < sched_out
       → Undertime; compute undertime minutes
     punch outside all schedule windows (no form)
       → anomaly_flag = TRUE; HR reviews; rounded to on-time after HR verification
5. Compute segment_hours = (C/Out − C/In) adjusted for crosses_midnight
6. Compute total_hours_day = SUM(segment_hours across all segments)
7. Apply break deduction:
     if total_hours_day > break_deduct_threshold_hours
     AND shift.has_break = TRUE (set by coordinator at roster drafting)
     AND (shift.is_graveyard = FALSE OR break_applies_to_graveyard = TRUE)
8. Determine day_scenario:
     Check tbl_holiday for that date + company_id
     Check tbl_schedule_date_annotation for activating flags (DOD, OT, etc.)
     Set day_scenario: 'regular' | 'rest_day' | 'regular_holiday' | 'special_holiday' | ...
9. Apply rate multipliers from tbl_computation_rules per day_scenario
10. Populate tbl_timekeeping, tbl_deduction, tbl_additional, tbl_dod
```

### No Published Schedule at Punch Time

If a punch arrives before the schedule is published (or employee has no schedule):
- Create `tbl_timekeeping` row with `schedule_id = NULL`,
  `classification_status = 'unclassified'`
- Notify HR Admin via `MISSED_PUNCH_DETECTED` or `BIOMETRIC_NOT_ENROLLED` as appropriate
- When schedule is later published, a recomputation job retroactively classifies
  all `unclassified` rows for that employee in that cutoff

### sched_type vs tbl_schedule_date_annotation — both exist, different roles

- `tbl_schedule.sched_type` = the coordinator's primary cell label; what the grid displays
- `tbl_schedule_date_annotation` = additional computation-activating flags on the same date;
  a date can have multiple annotations (e.g., `dod` + `regular_ot` simultaneously)
- The timekeeping engine reads both. `sched_type` drives the grid cell display.
  Annotations drive `day_scenario` in `tbl_timekeeping`.

### Net Total Formula

```
Net Total = Regular Hours
          + Early OT + Late OT
          + Night Differential
          + DOD pay + DOD OT + DOD ND
          − Late deduction
          − Undertime deduction
          − Half-day deduction
          − Break deduction
```

All multipliers sourced from `tbl_computation_rules` per `company_id`. Snapshot values stored
in `tbl_additional.ot_multiplier_snapshot` and `nd_rate_snapshot` at computation time so
rate changes don't retroactively affect closed cutoffs.

---

## SCHEMA PATCHES (v5.0)

These are confirmed patches from `OPEN_ITEMS.md` Part 4.
They are **not in the base v5.0 DDL** and must be applied as migration `002_patches.sql`.

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
    ENUM('classified','unclassified','manual_review') NOT NULL DEFAULT 'unclassified'
  AFTER is_absent;

-- 4. Add Operations Head sign-off to tbl_cutoff_schedule_status
ALTER TABLE tbl_cutoff_schedule_status
  ADD COLUMN noted_by_user_id INT NULL AFTER publish_source,
  ADD COLUMN noted_at TIMESTAMP NULL AFTER noted_by_user_id,
  ADD CONSTRAINT fk_noted_user
    FOREIGN KEY (noted_by_user_id) REFERENCES tbl_user_account(user_acc_id);

-- 5. Add composite index to tbl_raw_device_logs (reconciliation + direction queries)
ALTER TABLE tbl_raw_device_logs
  ADD KEY idx_rdl_user_time (device_user_id, record_time);

-- 6. Unique constraint on tbl_cutoff_period
ALTER TABLE tbl_cutoff_period
  ADD UNIQUE KEY uq_cutoff_company_start (company_id, start_date);

-- 7. Biometric UID change audit table
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

-- 8. remaining_credits as generated column in tbl_leave_balance
--    (Drop and re-add — must be done at migration time, not ALTER in place)
--    remaining_credits DECIMAL(5,2) GENERATED ALWAYS AS
--      (total_credits - used_credits + carryover_credits) STORED

-- 9. Remove shift_order from tbl_schedule (derive from slot_id → tbl_shift_slot.slot_order)
ALTER TABLE tbl_schedule DROP COLUMN shift_order;

-- 10. Convert total_hours on tbl_shift to VIRTUAL GENERATED column
ALTER TABLE tbl_shift DROP COLUMN total_hours;
ALTER TABLE tbl_shift ADD COLUMN total_hours DECIMAL(5,2)
  GENERATED ALWAYS AS (
    CASE WHEN crosses_midnight
      THEN ((24*60 - TIME_TO_SEC(time_in)/60) + TIME_TO_SEC(time_out)/60) / 60
      ELSE (TIME_TO_SEC(time_out) - TIME_TO_SEC(time_in)) / 3600
    END
  ) VIRTUAL AFTER time_out;

-- 11. Add unique constraint to tbl_employee_employment_history
ALTER TABLE tbl_employee_employment_history
  ADD UNIQUE KEY uq_emphistory (employee_id, start_date, employment_type_id);

-- 12. Add unique constraint to tbl_holiday
ALTER TABLE tbl_holiday
  ADD UNIQUE KEY uq_holiday_company_date (company_id, holiday_date);
```

---

## DEVICE PROTOCOL (ADMS)

The ZKTeco UF100 supports two sync modes. Use **both**:

### Pull sync — `zk-sync.js` (every 10s)
Connects via TCP, calls `zkInstance.getAttendances()`, filters by `last_stamp` cursor.

```javascript
// Advance cursor only after a successful batch insert
await pool.query(
  `UPDATE tbl_device_sync SET last_stamp = ?, updated_at = NOW() WHERE serial_number = ?`,
  [maxStamp, deviceSerial]
);
```

### Push sync — ADMS endpoints (device calls server)

Mount these under Express before any auth middleware — the device cannot authenticate:

```
GET  /iclock/cdata         → Heartbeat / stamp handshake. Respond: OK + current stamp.
GET  /iclock/getrequest    → Device polling for pending commands. Return next PENDING from queue.
POST /iclock/devicecmd     → Device reports command result. Mark queue entry ACKNOWLEDGED.
POST /iclock/attendance    → Device pushes attendance records (JSON). Insert after direction resolve.
POST /iclock/cdata         → Legacy raw format attendance push. Handle same as above.
```

### Command queue state model

```
PENDING → SENT (on /iclock/getrequest) → ACKNOWLEDGED (on /iclock/devicecmd)
```

Commands are used to push new users to the device. Stale SENT commands
(no acknowledgement after N minutes) should be retried by resetting to PENDING.

### Duplicate guard

Always check before insert:
```sql
SELECT COUNT(*) FROM tbl_raw_device_logs WHERE device_user_id = ? AND record_time = ?
```
If count > 0, skip silently.

---

## SYNC CURSOR

`tbl_device_sync` holds one row per device serial with `last_stamp`.
On each sync cycle, only process logs where `log.userSn > last_stamp`.
Update `last_stamp` to `maxStamp` of the batch after all inserts succeed.
Never advance the cursor inside a failing batch.

---

## FRONTEND CONVENTIONS

**Session (auth.js):**
```javascript
function checkSession() {
  const user = localStorage.getItem('hris_user');
  if (!user) { window.location.href = '/login.html'; return null; }
  return JSON.parse(user);
}

function requireRole(...allowedRoles) {
  const user = checkSession();
  if (!user) return;
  if (!allowedRoles.includes(user.role)) {
    window.location.href = '/login.html';
  }
  return user;
}
```

**Timezone — always Manila (+08:00):**
```javascript
function getManilaDateISO() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}
// Format dates for display
function fmtDate(val) {
  if (!val) return '—';
  return new Date(val).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtPeso(val) {
  if (val == null || val === '') return '—';
  return '₱' + parseFloat(val).toLocaleString('en-PH', { minimumFractionDigits: 2 });
}
```

**Cutoff periods (Philippine standard):**
- Period 1: 11th – 25th of each month
- Period 2: 26th of current month – 10th of next month
- Use `getCurrentCutoff()` / `getNextCutoff()` helpers in `config.js`

**API calls — always use fetch with explicit error handling:**
```javascript
const res = await fetch(`${CONFIG.API_BASE}/endpoint`);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const data = await res.json();
```

**Employee name display — Last, First Middle:**
```javascript
function formatEmployeeName(row) {
  const last = (row.last_name || '').trim();
  const first = [row.first_name, row.middle_name].filter(Boolean).join(' ').trim();
  return last ? (first ? `${last}, ${first}` : last) : (first || '—');
}
```

---

## API CONVENTIONS

**Response shape — always consistent:**
```javascript
// Success
res.json({ success: true, data: {...} });
res.json({ success: true, message: "Created" });

// Client error
res.status(400).json({ success: false, error: "Missing required fields" });
res.status(404).json({ success: false, error: "Not found" });

// Server error
res.status(500).json({ success: false, error: err.message });
```

**Response caching on high-traffic reads (employee list, schedule grid):**
```javascript
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cache = null, cacheTime = 0;

if (cache && Date.now() - cacheTime < CACHE_TTL) return res.json(cache);
// ... fetch from DB ...
cache = result; cacheTime = Date.now();
```

Invalidate the cache on any write to the same domain.

---

## LOGGING CONVENTION

Use emoji prefixes consistently in console output:

| Prefix | Meaning |
|---|---|
| `✅` | Success |
| `❌` | Error |
| `⚠️` | Warning / skipped |
| `📋` | Information |
| `🔄` | Processing / sync cycle |
| `📡` | Device communication |
| `🔢` | UID assignment |
| `🤖` | Auto-detection result |
| `⏱️` | Timing / duration |
| `🌙` | Overnight shift logic |
| `⏰` | 14-hour reset triggered |

---

## DATABASE DESIGN PRINCIPLES

- All tables: `created_at`, `created_by`, `updated_at`, `updated_by`
- Shared schema for both companies; `company_id` discriminates all company-scoped tables
- Salary precedence (highest wins): individual override → position rate → regional wage floor
- Three-tier biometric matching: UID → name → last 3 digits of employee number
- Timekeeping uses `segment_order` (1=primary, 2=continuation) for split/broken-time shifts
- Leave allocation: tenure-based (5/6/7 days VL); SL cashes out at year-end
- Punch deduplication window: 60 seconds (configurable in `tbl_computation_rules`)

Full schema: `CONTEXT_SUMMARY_UNO.md` — do not deviate without updating it.

---

## MUST-HAVE FEATURES (MVP — target May 9, 2026)

1. **Employee masterlist** — import from Excel, full CRUD, 201/202 file system
2. **Biometric device bridge** — live punch capture, raw log storage, socket.io feed
3. **Punch direction engine** — C/In / C/Out computation before every insert
4. **Reconciliation** — device_user_id → employee matching; flag unresolved
5. **Schedule grid** — 15-day roster per subdepartment, shift presets, publication lock
6. **Timekeeping computation** — late, undertime, OT, ND, DOD; paired punches
7. **Deduction / additional tables** — computed per cutoff
8. **Leave management** — VL/SL balance, tenure-based allocation, year-end cashout
9. **Override/request forms** — OT, late, punch correction; direct HR approval flow (no coordinator endorsement step)
   - Employee requests go directly to HR; HR approves/modifies and saves to DB
   - Coordinator is notified of approved changes that affect their subdept (manpower gaps, schedule impacts)
   - Coordinator handles operational response via Schedule grid — they have no Requests page
   - Legal under PH labor law; audit trail via `reviewed_by` + `reviewed_at` on all approvals
   - Schema note: `endorsed` state in `tbl_leave.status` and `endorsement_status` in `tbl_form_upload` are unused — drop before building backend services
10. **Reports** — PDF + Excel export; timekeeping summary per cutoff
11. **Auth** — JWT login, 5 roles, subdept scoping for HR + Coord
12. **Audit log** — every write action recorded; append-only

### Post-MVP (do not build until MVP ships)

- Service charges (DOLE DO 242-2024) — schema ready, computation deferred
- 13th month pay computation
- Email/SMS notifications
- Reconciliation UI (manual match interface)
- Second device onboarding
- Reports: government forms (SSS, PhilHealth, BIR)

---

## ROLES

| Role | Enum | Scope |
|---|---|---|
| Super Admin | `super_admin` | System-wide |
| HR Admin | `hr` | Optional subdept scope; full CRUD + approvals |
| Coordinator / OIC | `coord` | Assigned subdepts only; schedule drafting only; no requests queue, no approvals; notified of HR-approved changes affecting their subdept |
| IT Admin | `it` | Device mgmt, user accounts, override submission |
| Admin | `admin` | View-only; no payroll write access |

Bootstrap account (`is_bootstrap = TRUE`) created at migration; deactivated after first real super_admin confirmed.

---

## MULTI-TENANCY (JULIE EXPANSION)

Julie is the future SaaS version of MINERVA serving multiple hotel clients.
Keep these clean for that transition — do not let them rot:

- Every company-scoped table has `company_id` — never query without it
- No hardcoded company names or IDs in business logic
- `tbl_computation_rules` is per-company — business rules must always be fetched by `company_id`
- `tbl_device` rows include `company_id` — device identity must never be assumed
- Auth scoping (`tbl_user_scope`) already supports per-subdept access; extend to per-tenant for SaaS

When the time comes, the main migration path is:
1. Add `tenant_id` as a discriminator above `company_id`
2. Introduce a tenant registry table
3. Move `company_id` filtering to a middleware layer

Do not build for this now. Just don't write code that would need to be ripped out.

---

## INFRASTRUCTURE

- **OS:** Ubuntu 22.04 LTS
- **Process manager:** PM2 (auto-restart, log rotation)
- **MySQL:** Single instance; enable binary logging for point-in-time recovery
- **Backups:** Daily `mysqldump` to a separate drive or NAS; retain 30 days
- **Reverse proxy:** Nginx (TLS termination + static file serving)
- No Docker, no replication — unnecessary at this scale

---

## DEADLINE

**May 9, 2026** — absolute client deadline. Scope MVP ruthlessly against this date.
**April 30, 2026** — internal milestone: core modules working end-to-end (employee masterlist, biometric bridge, punch direction, schedule grid, timekeeping). Does not have to be perfect — functional is the bar.
