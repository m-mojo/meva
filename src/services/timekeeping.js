// Timekeeping computation engine
// Implements the 9-step algorithm from CLAUDE.md
// Input:  employee_id + shift_date (or batch via cutoff_id)
// Output: rows in tbl_timekeeping + tbl_deduction + tbl_additional

const tkQ = require('../db/queries/timekeeping');
const bus = require('../notifications/bus');

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeStrToMinutes(timeStr) {
  if (!timeStr) return null;
  const parts = String(timeStr).split(':').map(Number);
  return parts[0] * 60 + (parts[1] || 0);
}

// Extract minutes-since-midnight in Manila time from a Date/timestamp.
// Philippines is UTC+8 with no DST — safe to use fixed offset.
function manilaMinutes(dt) {
  if (!dt) return null;
  const d = new Date(dt);
  return ((d.getUTCHours() + 8) % 24) * 60 + d.getUTCMinutes();
}

function overlapMin(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

// Time-interval intersection of [punchIn, punchOut] with [22:00–06:00] ND window.
// ndStart and ndEnd are already in minutes since midnight.
function computeNDHours(punchIn, punchOut, crossesMidnight, ndStart, ndEnd) {
  if (!punchIn || !punchOut) return 0;

  const inMin  = manilaMinutes(punchIn);
  const outMin = manilaMinutes(punchOut);
  if (inMin === null || outMin === null) return 0;

  const workSegs = crossesMidnight ? [[inMin, 1440], [0, outMin]] : [[inMin, outMin]];
  const ndSegs   = [[ndStart, 1440], [0, ndEnd]]; // ND window wraps midnight

  let total = 0;
  for (const [ws, we] of workSegs) {
    for (const [ns, ne] of ndSegs) {
      total += overlapMin(ws, we, ns, ne);
    }
  }
  return total / 60;
}

function hoursBetween(inTime, outTime, crossesMidnight) {
  const inMin  = manilaMinutes(inTime);
  const outMin = manilaMinutes(outTime);
  if (inMin === null || outMin === null) return 0;
  const diff = crossesMidnight ? (1440 - inMin + outMin) : (outMin - inMin);
  return Math.max(0, diff) / 60;
}

// ─── Punch pairing (D5) ──────────────────────────────────────────────────────
// Greedy forward scan: each C/In is paired with the next C/Out.
// Double C/In pushes an unpaired entry so anomaly detection fires correctly.
function pairPunches(punches) {
  const pairs = [];
  let openIn = null;

  for (const p of punches) {
    if (p.new_state === 'C/In') {
      if (openIn !== null) {
        pairs.push({ punchIn: openIn, punchOut: null }); // orphaned C/In (double C/In)
      }
      openIn = p.record_time;
    } else if (p.new_state === 'C/Out') {
      pairs.push({ punchIn: openIn ?? null, punchOut: p.record_time });
      openIn = null;
    }
  }

  if (openIn !== null) {
    pairs.push({ punchIn: openIn, punchOut: null }); // trailing orphaned C/In
  }

  return pairs;
}

// ─── Segment metrics ──────────────────────────────────────────────────────────

function computeSegmentMetrics(punchIn, punchOut, schedIn, schedOut, crossesMidnight, config, ndStart, ndEnd) {
  const graceMin   = config.grace_period_minutes       || 30;
  const earlyOtMin = config.early_ot_threshold_minutes || 30;
  const lateOtMin  = config.late_ot_threshold_minutes  || 30;

  const inMin  = punchIn  ? manilaMinutes(punchIn)      : null;
  const outMin = punchOut ? manilaMinutes(punchOut)     : null;
  const siMin  = schedIn  ? timeStrToMinutes(schedIn)   : null;
  const soMin  = schedOut ? timeStrToMinutes(schedOut)  : null;

  let lateMinutes      = 0;
  let undertimeMinutes = 0;
  let earlyOtHours     = 0;
  let lateOtHours      = 0;
  let otApprovalStatus = null;

  if (siMin !== null && inMin !== null) {
    if (inMin > siMin + graceMin) {
      lateMinutes = inMin - siMin;
    } else if (inMin < siMin - earlyOtMin) {
      earlyOtHours = (siMin - inMin) / 60;
      otApprovalStatus = 'flagged_no_form';
    }
  }

  if (soMin !== null && outMin !== null) {
    if (outMin < soMin) {
      undertimeMinutes = soMin - outMin;
    } else if (outMin > soMin + lateOtMin) {
      lateOtHours = (outMin - soMin) / 60;
      otApprovalStatus = otApprovalStatus || 'flagged_no_form';
    }
  }

  const otHours    = earlyOtHours + lateOtHours; // total stored in tbl_timekeeping
  const totalHours = punchIn && punchOut ? hoursBetween(punchIn, punchOut, crossesMidnight) : 0;
  const ndHours    = computeNDHours(punchIn, punchOut, crossesMidnight, ndStart, ndEnd);

  return { lateMinutes, undertimeMinutes, otHours, earlyOtHours, lateOtHours, otApprovalStatus, totalHours, ndHours };
}

// ─── Core computation ────────────────────────────────────────────────────────

async function computeDay(employeeId, shiftDate, companyId) {
  const [sched, [cutoffId, config, rates, holiday], punches] = await Promise.all([
    tkQ.getScheduleForDay(employeeId, shiftDate),
    Promise.all([
      tkQ.getCurrentCutoff(companyId, shiftDate),
      tkQ.getPunchConfig(companyId),
      tkQ.getRateConfig(companyId, shiftDate),
      tkQ.getHoliday(companyId, shiftDate),
    ]),
    tkQ.getPunchesForDay(employeeId, shiftDate),
  ]);

  const ndStart = config.nd_window_start ? timeStrToMinutes(String(config.nd_window_start)) : 1320;
  const ndEnd   = config.nd_window_end   ? timeStrToMinutes(String(config.nd_window_end))   : 360;

  // D5: greedy pair — handles double C/In, orphaned punches, and split shifts correctly
  const pairs = pairPunches(punches);

  const punchIn1  = pairs[0]?.punchIn  ?? null;
  const punchOut1 = pairs[0]?.punchOut ?? null;
  const punchIn2  = pairs[1]?.punchIn  ?? null;
  const punchOut2 = pairs[1]?.punchOut ?? null;

  const hasPunches = !!(punchIn1 || punchOut1);

  // No punches and no schedule — nothing to process
  if (!hasPunches && !sched) return null;

  // Step 8: day_scenario (NEW-19)
  const schedType = sched?.sched_type || null;
  let dayScenario;

  if (!sched) {
    dayScenario = 'unclassified';
  } else if (holiday) {
    const base = holiday.holiday_type === 'regular' ? 'regular_holiday' : 'special_holiday';
    dayScenario = sched.is_rest_day ? `${base}_rest_day` : base;
  } else if (sched.is_rest_day) {
    dayScenario = schedType === 'dod' ? 'dod' : 'rest_day';
  } else if (schedType === 'dod') {
    dayScenario = 'dod';
  } else {
    dayScenario = 'regular';
  }

  // NEW-21: No punches but has schedule — create absent row
  if (!hasPunches) {
    await tkQ.upsertRow({
      employee_id:               employeeId,
      cutoff_id:                 cutoffId,
      schedule_id:               sched.schedule_id,
      shift_date:                shiftDate,
      segment_order:             1,
      time_in:                   null,
      time_out:                  null,
      total_hours_day:           0,
      late_minutes:              0,
      undertime_minutes:         0,
      ot_hours:                  0,
      nd_hours:                  0,
      day_scenario:              dayScenario,
      classification_status:     'unclassified',
      anomaly_flag:              false,
      ot_approval_status:        null,
      undertime_approval_status: 'not_required',
      is_absent:                 true,
      has_break:                 false,
      created_by:                null,
    });
    return { employeeId, shiftDate, absent: true };
  }

  // Resolve effective schedule times — flex override takes precedence
  const schedIn        = sched?.flex_schedule ? sched.flex_time_in  : sched?.sched_time_in;
  const schedOut       = sched?.flex_schedule ? sched.flex_time_out : sched?.sched_time_out;
  const crossesMidnight = sched?.crosses_midnight || false;
  const isGraveyard    = sched?.is_graveyard     || false;
  const hasBreak       = sched?.has_break        || false;

  // Segment 1
  const anomalyFlag1 = !punchIn1 || !punchOut1;
  if (anomalyFlag1) {
    bus.emit('MISSED_PUNCH_DETECTED', { employeeId, shiftDate, segment: 1, punchIn: punchIn1, punchOut: punchOut1, companyId });
  }

  const seg1 = computeSegmentMetrics(punchIn1, punchOut1, schedIn, schedOut, crossesMidnight, config, ndStart, ndEnd);

  const breakApplies1    = !!(config.break_deduction_enabled && hasBreak &&
    seg1.totalHours > (config.break_deduct_threshold_hours || 8) &&
    (!isGraveyard || config.break_applies_to_graveyard));
  const breakDeductHrs1  = breakApplies1 ? (config.break_deduct_hours || 1) : 0;
  const classStatus1     = anomalyFlag1 ? 'manual_review' : (sched ? 'classified' : 'unclassified');

  await tkQ.upsertRow({
    employee_id:               employeeId,
    cutoff_id:                 cutoffId,
    schedule_id:               sched?.schedule_id || null,
    shift_date:                shiftDate,
    segment_order:             1,
    time_in:                   punchIn1,
    time_out:                  punchOut1,
    total_hours_day:           parseFloat(seg1.totalHours.toFixed(4)),
    late_minutes:              seg1.lateMinutes,
    undertime_minutes:         seg1.undertimeMinutes,
    ot_hours:                  parseFloat(seg1.otHours.toFixed(4)),
    nd_hours:                  parseFloat(seg1.ndHours.toFixed(4)),
    day_scenario:              dayScenario,
    classification_status:     classStatus1,
    anomaly_flag:              anomalyFlag1,
    ot_approval_status:        seg1.otApprovalStatus,
    undertime_approval_status: seg1.undertimeMinutes > 0 ? 'flagged_no_form' : 'not_required', // NEW-18
    is_absent:                 !punchIn1,
    has_break:                 hasBreak,
    created_by:                null,
  });

  await _writeDeductionAdditional(employeeId, shiftDate, 1, seg1, breakDeductHrs1, rates);

  // NEW-23: Segment 2 — only when continuation_shift_id is set on the schedule
  if (sched?.continuation_shift_id) {
    if (punchIn2 || punchOut2) {
      const anomalyFlag2 = !punchIn2 || !punchOut2;
      if (anomalyFlag2) {
        bus.emit('MISSED_PUNCH_DETECTED', { employeeId, shiftDate, segment: 2, punchIn: punchIn2, punchOut: punchOut2, companyId });
      }

      const seg2 = computeSegmentMetrics(
        punchIn2, punchOut2,
        sched.cont_time_in, sched.cont_time_out,
        sched.cont_crosses_midnight || false,
        config, ndStart, ndEnd
      );

      const contIsGraveyard  = sched.cont_is_graveyard || false;
      const contHasBreak     = sched.cont_has_break    || false;
      const breakApplies2    = !!(config.break_deduction_enabled && contHasBreak &&
        seg2.totalHours > (config.break_deduct_threshold_hours || 8) &&
        (!contIsGraveyard || config.break_applies_to_graveyard));
      const breakDeductHrs2  = breakApplies2 ? (config.break_deduct_hours || 1) : 0;

      await tkQ.upsertRow({
        employee_id:               employeeId,
        cutoff_id:                 cutoffId,
        schedule_id:               sched.schedule_id,
        shift_date:                shiftDate,
        segment_order:             2,
        time_in:                   punchIn2,
        time_out:                  punchOut2,
        total_hours_day:           parseFloat(seg2.totalHours.toFixed(4)),
        late_minutes:              seg2.lateMinutes,
        undertime_minutes:         seg2.undertimeMinutes,
        ot_hours:                  parseFloat(seg2.otHours.toFixed(4)),
        nd_hours:                  parseFloat(seg2.ndHours.toFixed(4)),
        day_scenario:              dayScenario,
        classification_status:     anomalyFlag2 ? 'manual_review' : 'classified',
        anomaly_flag:              anomalyFlag2,
        ot_approval_status:        seg2.otApprovalStatus,
        undertime_approval_status: seg2.undertimeMinutes > 0 ? 'flagged_no_form' : 'not_required',
        is_absent:                 false,
        has_break:                 contHasBreak,
        created_by:                null,
      });

      await _writeDeductionAdditional(employeeId, shiftDate, 2, seg2, breakDeductHrs2, rates);

    } else {
      // Continuation expected but no punches — flag segment 2 row
      bus.emit('MISSED_PUNCH_DETECTED', { employeeId, shiftDate, segment: 2, punchIn: null, punchOut: null, companyId });
      await tkQ.upsertRow({
        employee_id:               employeeId,
        cutoff_id:                 cutoffId,
        schedule_id:               sched.schedule_id,
        shift_date:                shiftDate,
        segment_order:             2,
        time_in:                   null,
        time_out:                  null,
        total_hours_day:           0,
        late_minutes:              0,
        undertime_minutes:         0,
        ot_hours:                  0,
        nd_hours:                  0,
        day_scenario:              dayScenario,
        classification_status:     'manual_review',
        anomaly_flag:              true,
        ot_approval_status:        null,
        undertime_approval_status: 'not_required',
        is_absent:                 false,
        has_break:                 sched.cont_has_break || false,
        created_by:                null,
      });
    }
  }

  return { employeeId, shiftDate, totalHoursDay: seg1.totalHours, lateMinutes: seg1.lateMinutes, otHours: seg1.otHours, dayScenario };
}

async function _writeDeductionAdditional(employeeId, shiftDate, segmentOrder, seg, breakDeductHours, rates) {
  await tkQ.writeDeduction(
    employeeId, shiftDate, segmentOrder,
    seg.lateMinutes / 60, seg.undertimeMinutes / 60, breakDeductHours
  );

  if (seg.earlyOtHours > 0 || seg.lateOtHours > 0 || seg.ndHours > 0) {
    await tkQ.writeAdditional(
      employeeId, shiftDate, segmentOrder,
      seg.earlyOtHours, seg.lateOtHours, seg.ndHours,
      rates.eot_multiplier || 1.25,
      rates.nd_rate        || 0.10
    );
  }
}

// ─── Batch operations ────────────────────────────────────────────────────────

async function computeCutoff(cutoffId, companyId) {
  const cutoff = await tkQ.getCutoffById(cutoffId);
  if (!cutoff) throw new Error(`Cutoff ${cutoffId} not found`);

  // D2 guard: never overwrite an already-exported payroll period
  if (cutoff.is_exported) {
    throw Object.assign(new Error('Cutoff is already exported and cannot be recomputed'), { status: 409 });
  }

  const employees = await tkQ.getActiveEmployees(companyId);

  const { start_date, end_date } = cutoff;
  const start = new Date(start_date);
  const end   = new Date(end_date);

  let processed = 0;
  for (const { employee_id } of employees) {
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) { // NEW-22
      const dateStr = d.toISOString().slice(0, 10);
      await computeDay(employee_id, dateStr, companyId).catch(err =>
        console.error(`❌ [timekeeping] ${employee_id} @ ${dateStr}: ${err.message}`)
      );
      processed++;
    }
  }

  return { processed };
}

async function runPendingRecompute(companyId) {
  const rows = await tkQ.getPendingRecompute(companyId);
  for (const { employee_id, shift_date } of rows) {
    await computeDay(employee_id, shift_date, companyId).catch(err =>
      console.error(`❌ [recompute] ${employee_id} @ ${shift_date}: ${err.message}`)
    );
  }
  return { recomputed: rows.length };
}

async function listByCutoff(cutoffId, companyId, subdeptId) {
  return tkQ.findByCutoff(cutoffId, companyId, subdeptId || null);
}

async function lockRow(tkId, userId) {
  return tkQ.lock(tkId, userId);
}

async function unlockRow(tkId, userId) {
  return tkQ.unlock(tkId, userId);
}

module.exports = { computeDay, computeCutoff, runPendingRecompute, listByCutoff, lockRow, unlockRow };
