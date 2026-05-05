const devQ = require('../db/queries/devices');

async function list(ctx) {
  return devQ.findAll(ctx.company_id);
}

async function recentLogs(deviceId, limit, ctx) {
  return devQ.getRecentLogs(deviceId, ctx.company_id, limit);
}

async function unresolvedLogs(ctx) {
  return devQ.getUnresolvedLogs(ctx.company_id);
}

async function queueCommand(deviceId, params, ctx) {
  const { command_type, target_employee_id, target_device_user_id, command_data } = params;
  if (!command_type) throw Object.assign(new Error('command_type required'), { status: 400 });
  return devQ.queueCommand({
    deviceId,
    commandType:        command_type,
    targetEmployeeId:   target_employee_id   || null,
    targetDeviceUserId: target_device_user_id || null,
    commandData:        command_data          || null,
    createdBy:          ctx.user_id,
  });
}

module.exports = { list, recentLogs, unresolvedLogs, queueCommand };
