// resolveLogType — 5-rule punch direction algorithm
// Input:  deviceUserId (string), recordTime (Date|string), companyId (int)
// Output: { direction: 'C/In'|'C/Out'|null, shiftDate: 'YYYY-MM-DD'|null }
// null direction = duplicate within window — caller must skip insert

'use strict';

const { queryWithRetry } = require('../config/db');

function getManilaDateStr(dt) {
  return new Date(dt).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function diffSeconds(earlier, later) {
  return (new Date(later) - new Date(earlier)) / 1000;
}

function diffHours(earlier, later) {
  return (new Date(later) - new Date(earlier)) / 3_600_000;
}

function toDateStr(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  return String(val).slice(0, 10);
}

async function getPunchConfig(companyId) {
  const [rows] = await queryWithRetry(
    `SELECT duplicate_punch_window_seconds, punch_reset_hours
     FROM tbl_punch_config WHERE company_id = ? LIMIT 1`,
    [companyId]
  );
  return rows[0] || { duplicate_punch_window_seconds: 60, punch_reset_hours: 14 };
}

// Scoped by device_id — device_user_id is unique per physical device, not per company.
// A shared device serves both companies; company discrimination happens at reconciliation.
async function getLastPunch(deviceUserId, deviceId) {
  const [rows] = await queryWithRetry(
    `SELECT new_state, shift_date, record_time
     FROM tbl_raw_device_logs
     WHERE device_user_id = ? AND device_id = ? AND new_state IS NOT NULL
     ORDER BY record_time DESC LIMIT 1`,
    [deviceUserId, deviceId]
  );
  return rows[0] || null;
}

// Attempt to resolve device_user_id → employee_id for Rule 3 crosses_midnight check.
// Returns null when unresolved — Rule 3 is safely skipped in that case.
async function tryResolveEmployeeId(deviceUserId, companyId) {
  const [rows] = await queryWithRetry(
    `SELECT employee_id FROM tbl_employees
     WHERE biometric_device_uid = ? AND company_id = ? AND is_active = TRUE LIMIT 1`,
    [deviceUserId, companyId]
  );
  return rows[0]?.employee_id ?? null;
}

// Check whether the shift on lastShiftDate for this employee crosses midnight.
// Returns false if no schedule or shift found (safe fallback — Rule 3 does not fire).
async function lastShiftCrossesMidnight(employeeId, lastShiftDate) {
  const [rows] = await queryWithRetry(
    `SELECT sh.crosses_midnight
     FROM tbl_schedule sc
     JOIN tbl_shift sh ON sh.shift_id = sc.shift_id
     WHERE sc.employee_id = ? AND sc.date = ? AND sc.is_draft = FALSE
     LIMIT 1`,
    [employeeId, lastShiftDate]
  );
  return Boolean(rows[0]?.crosses_midnight);
}

async function resolveLogType(deviceUserId, recordTime, companyId, deviceId) {
  const manilaToday = getManilaDateStr(recordTime);
  const [config, last] = await Promise.all([
    getPunchConfig(companyId),
    getLastPunch(deviceUserId, deviceId),
  ]);

  const resetHours = Number(config.punch_reset_hours) || 14;

  // Rule 1: No previous punch on record
  if (!last) {
    console.log(`📋 [direction] R1 first punch — ${deviceUserId}`);
    return { direction: 'C/In', shiftDate: manilaToday };
  }

  const secsSinceLast  = diffSeconds(last.record_time, recordTime);
  const hoursSinceLast = diffHours(last.record_time, recordTime);
  const lastShiftDate  = toDateStr(last.shift_date);

  // Rule 2: Duplicate punch within window — skip
  if (secsSinceLast < config.duplicate_punch_window_seconds) {
    console.log(`⚠️  [direction] R2 duplicate skip — ${deviceUserId} (${secsSinceLast.toFixed(1)}s)`);
    return { direction: null, shiftDate: null };
  }

  // Rule 3: Overnight shift completion
  // Fires only when: last punch was C/In on a prior date AND the shift was a crossing-midnight shift.
  // Requires employee resolution; if unresolved, skips safely (Rule 5 handles it as a toggle).
  if (
    last.new_state === 'C/In' &&
    lastShiftDate &&
    lastShiftDate < manilaToday &&
    hoursSinceLast < resetHours
  ) {
    const employeeId = await tryResolveEmployeeId(deviceUserId, companyId);
    const crossesMidnight = employeeId
      ? await lastShiftCrossesMidnight(employeeId, lastShiftDate)
      : false;

    if (crossesMidnight) {
      console.log(`🌙 [direction] R3 overnight C/Out — ${deviceUserId} shift_date=${lastShiftDate}`);
      return { direction: 'C/Out', shiftDate: lastShiftDate };
    }
  }

  // Rule 4: Reset threshold exceeded — treat as fresh C/In
  if (hoursSinceLast > resetHours) {
    console.log(`⏰ [direction] R4 ${resetHours}h reset — ${deviceUserId}`);
    return { direction: 'C/In', shiftDate: manilaToday };
  }

  // Rule 5: Toggle
  const direction = last.new_state === 'C/In' ? 'C/Out' : 'C/In';
  const shiftDate  = direction === 'C/Out' ? (lastShiftDate || manilaToday) : manilaToday;
  console.log(`🔄 [direction] R5 toggle ${last.new_state}→${direction} — ${deviceUserId}`);
  return { direction, shiftDate };
}

module.exports = { resolveLogType };
