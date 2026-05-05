const { queryWithRetry } = require('../config/db');
const leaveQ = require('../db/queries/leave');

async function getMyLeaves(ctx) {
  if (!ctx.employee_id) throw Object.assign(new Error('No employee record linked to this account'), { status: 403 });
  return leaveQ.findByEmployee(ctx.employee_id, ctx.company_id);
}

async function getLeavesByEmployee(employeeId, ctx) {
  return leaveQ.findByEmployee(employeeId, ctx.company_id);
}

async function getLeavesByStatus(status, ctx) {
  return leaveQ.findByStatus(ctx.company_id, status);
}

async function getBalances(employeeId, ctx) {
  const isHr = ctx.role === 'hr' || ctx.role === 'super_admin';
  if (!isHr && ctx.employee_id !== employeeId) {
    throw Object.assign(new Error('Access denied'), { status: 403 });
  }
  return leaveQ.getAllBalances(employeeId, ctx.company_id);
}

async function applyLeave(data, ctx) {
  if (!data.employee_id || !data.leave_type_id || !data.start_date || !data.end_date || !data.cutoff_id) {
    throw Object.assign(new Error('employee_id, leave_type_id, start_date, end_date, cutoff_id required'), { status: 400 });
  }

  const balance = await leaveQ.getBalance(data.employee_id, data.leave_type_id);
  if (balance && balance.remaining_credits < data.leave_days) {
    throw Object.assign(new Error('Insufficient leave balance'), { status: 422 });
  }

  const leaveId = await leaveQ.create(data, ctx.user_id);
  return { leave_id: leaveId };
}

async function approveLeave(leaveId, ctx) {
  const n = await leaveQ.updateStatus(leaveId, 'approved', ctx.user_id);
  if (!n) throw Object.assign(new Error('Leave not found or already processed'), { status: 404 });

  // Deduct balance on approval — use the leave record's employee_id, not the approver's
  const [rows] = await queryWithRetry(
    `SELECT employee_id, leave_type_id, leave_days FROM tbl_leave WHERE leave_id = ?`,
    [leaveId]
  );
  if (rows[0]) {
    const leave = rows[0];
    await leaveQ.deductBalance(leave.employee_id, leave.leave_type_id, leave.leave_days);
  }
}

async function denyLeave(leaveId, ctx) {
  const n = await leaveQ.updateStatus(leaveId, 'denied', ctx.user_id);
  if (!n) throw Object.assign(new Error('Leave not found'), { status: 404 });
}

module.exports = { getMyLeaves, getLeavesByEmployee, getLeavesByStatus, getBalances, applyLeave, approveLeave, denyLeave };
