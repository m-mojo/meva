// Seed tbl_audit_action with all system action codes
// Safe to re-run (uses INSERT IGNORE)
// Run: node scripts/seed-audit-actions.js

require('../src/config/env');
const { queryWithRetry, pool } = require('../src/config/db');

const ACTIONS = [
  /* User management */
  { code: 'USER_CREATED',         label: 'User Created',         bg: '#edfaf2', color: '#1a6b3a' },
  { code: 'USER_DEACTIVATED',     label: 'User Deactivated',     bg: '#fff0f0', color: '#c0294a' },
  { code: 'USER_REACTIVATED',     label: 'User Reactivated',     bg: '#edfaf2', color: '#1a6b3a' },
  { code: 'ROLE_ADDED',           label: 'Role Added',           bg: '#f3f0fb', color: '#5340a8' },
  { code: 'ROLE_DEACTIVATED',     label: 'Role Deactivated',     bg: '#fff0f0', color: '#c0294a' },
  { code: 'ROLE_REACTIVATED',     label: 'Role Reactivated',     bg: '#edfaf2', color: '#1a6b3a' },

  /* Org structure */
  { code: 'DEPT_ADDED',           label: 'Dept Added',           bg: '#e8f0fb', color: '#1a5ca8' },
  { code: 'SUBDEPT_ADDED',        label: 'Subdept Added',        bg: '#e8f0fb', color: '#1a5ca8' },
  { code: 'SUBDEPT_EDITED',       label: 'Subdept Edited',       bg: '#fff8ec', color: '#b8680a' },
  { code: 'SUBDEPT_DELETED',      label: 'Subdept Deleted',      bg: '#fff0f0', color: '#c0294a' },
  { code: 'POSITION_ADDED',       label: 'Position Added',       bg: '#e8f7f4', color: '#0a6b56' },
  { code: 'POSITION_EDITED',      label: 'Position Edited',      bg: '#fff8ec', color: '#b8680a' },
  { code: 'POSITION_DELETED',     label: 'Position Deleted',     bg: '#fff0f0', color: '#c0294a' },
  { code: 'HEAD_ASSIGNED',        label: 'Head Assigned',        bg: '#e8f0fb', color: '#1a5ca8' },
  { code: 'HEAD_REMOVED',         label: 'Head Removed',         bg: '#fff0f0', color: '#c0294a' },
  { code: 'ACCESS_UPDATED',       label: 'Access Updated',       bg: '#fff8ec', color: '#b8680a' },

  /* Timekeeping & overrides */
  { code: 'TIME_OVERRIDE',        label: 'Time Override',        bg: '#fff8ec', color: '#b8680a' },
  { code: 'TIMEKEEPING_LOCKED',   label: 'TK Locked',            bg: '#fff8ec', color: '#b8680a' },
  { code: 'TIMEKEEPING_OVERRIDE', label: 'TK Override',          bg: '#fff8ec', color: '#b8680a' },
  { code: 'TIMEKEEPING_COMPUTE',  label: 'TK Computed',          bg: '#edfaf2', color: '#1a6b3a' },

  /* Device events */
  { code: 'DEVICE_REGISTERED',   label: 'Device Registered',    bg: '#f3f0fb', color: '#5340a8' },
  { code: 'DEVICE_CONFIG',        label: 'Config Updated',       bg: '#fff8ec', color: '#b8680a' },
  { code: 'DEVICE_SYNC',          label: 'Device Sync',          bg: '#f3f0fb', color: '#5340a8' },
  { code: 'DEVICE_SYNC_FAILED',   label: 'Sync Failed',          bg: '#fff0f0', color: '#c0294a' },
  { code: 'DEVICE_SYNC_ATTEND',   label: 'Attendance Sync',      bg: '#f3f0fb', color: '#5340a8' },
  { code: 'DEVICE_DECOMM',        label: 'Decommissioned',       bg: '#fff0f0', color: '#c0294a' },
  { code: 'DEVICE_DIAG',          label: 'Diagnostic Run',       bg: '#e8f0fb', color: '#1a5ca8' },

  /* Employee events */
  { code: 'EMPLOYEE_CREATED',     label: 'Employee Created',     bg: '#edfaf2', color: '#1a6b3a' },
  { code: 'EMPLOYEE_EDITED',      label: 'Employee Edited',      bg: '#fff8ec', color: '#b8680a' },
  { code: 'EMPLOYEE_DEACTIVATED', label: 'Employee Deactivated', bg: '#fff0f0', color: '#c0294a' },
  { code: 'BIOMETRIC_ENROLLED',   label: 'Biometric Enrolled',   bg: '#edfaf2', color: '#1a6b3a' },
  { code: 'BIOMETRIC_CHANGED',    label: 'Biometric Changed',    bg: '#fff8ec', color: '#b8680a' },

  /* Leave & requests */
  { code: 'LEAVE_APPROVED',       label: 'Leave Approved',       bg: '#edfaf2', color: '#1a6b3a' },
  { code: 'LEAVE_DENIED',         label: 'Leave Denied',         bg: '#fff0f0', color: '#c0294a' },
  { code: 'LEAVE_APPLIED',        label: 'Leave Applied',        bg: '#e8f0fb', color: '#1a5ca8' },
  { code: 'REQUEST_APPROVED',     label: 'Request Approved',     bg: '#edfaf2', color: '#1a6b3a' },
  { code: 'REQUEST_DENIED',       label: 'Request Denied',       bg: '#fff0f0', color: '#c0294a' },
  { code: 'REQUEST_SUBMITTED',    label: 'Request Submitted',    bg: '#e8f0fb', color: '#1a5ca8' },

  /* Schedule events */
  { code: 'SCHEDULE_PUBLISHED',   label: 'Schedule Published',   bg: '#edfaf2', color: '#1a6b3a' },
  { code: 'SCHEDULE_OVERRIDDEN',  label: 'Schedule Override',    bg: '#fff8ec', color: '#b8680a' },
  { code: 'SCHEDULE_SUBMITTED',   label: 'Schedule Submitted',   bg: '#e8f0fb', color: '#1a5ca8' },

  /* System */
  { code: 'SETTINGS_CHANGE',      label: 'Settings Change',      bg: '#e8f0fb', color: '#1a5ca8' },
  { code: 'SYSTEM_LOGIN',         label: 'User Login',           bg: '#e8f7f4', color: '#0a6b56' },
  { code: 'SYSTEM_LOGOUT',        label: 'User Logout',          bg: '#e8f7f4', color: '#0a6b56' },
  { code: 'HOLIDAY_ADDED',        label: 'Holiday Added',        bg: '#e8f0fb', color: '#1a5ca8' },
  { code: 'HOLIDAY_REMOVED',      label: 'Holiday Removed',      bg: '#fff0f0', color: '#c0294a' },
];

async function run() {
  console.log(`📋 Seeding ${ACTIONS.length} audit action types...`);
  let inserted = 0;
  let skipped  = 0;

  for (const a of ACTIONS) {
    try {
      const [res] = await queryWithRetry(
        `INSERT IGNORE INTO tbl_audit_action
           (action_code, label, badge_bg, badge_color, is_active)
         VALUES (?, ?, ?, ?, TRUE)`,
        [a.code, a.label, a.bg, a.color]
      );
      if (res.affectedRows > 0) {
        console.log(`  ✅ ${a.code} — ${a.label}`);
        inserted++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.error(`  ❌ ${a.code} — ${err.message}`);
    }
  }

  console.log(`\nDone. Inserted: ${inserted}, Skipped (already exist): ${skipped}`);
  await pool.end();
  process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
