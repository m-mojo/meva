const schedQ = require('../db/queries/schedule');
const bus    = require('../notifications/bus');

async function getGrid(cutoffId, subdeptId, ctx) {
  return schedQ.getGrid(cutoffId, subdeptId);
}

async function saveCell(cellData, ctx) {
  if (!cellData.cutoff_id || !cellData.employee_id || !cellData.sched_date) {
    throw Object.assign(new Error('cutoff_id, employee_id, sched_date required'), { status: 400 });
  }
  await schedQ.upsertCell(cellData, ctx.user_id);
}

async function saveCells(cells, ctx) {
  for (const cell of cells) {
    await saveCell(cell, ctx);
  }
}

async function submitForReview(cutoffId, subdeptId, ctx) {
  const status = await schedQ.getStatus(cutoffId, subdeptId);
  if (status?.schedule_state === 'locked') {
    throw Object.assign(new Error('Schedule is locked'), { status: 409 });
  }
  await schedQ.setStatus(cutoffId, subdeptId, 'closing', ctx.user_id);
  bus.emit('SCHEDULE_SUBMITTED', { cutoffId, subdeptId, submittedBy: ctx.user_id });
}

async function noteByOpHead(cutoffId, subdeptId, ctx) {
  const n = await schedQ.noteByOpHead(cutoffId, subdeptId, ctx.user_id);
  if (!n) throw Object.assign(new Error('No schedule status row found or already noted'), { status: 409 });
  bus.emit('SCHEDULE_NOTED', { cutoffId, subdeptId, notedBy: ctx.user_id });
}

async function publish(cutoffId, subdeptId, ctx) {
  const status = await schedQ.getStatus(cutoffId, subdeptId);
  if (!status?.noted_by_user_id) {
    throw Object.assign(new Error('Operations Head sign-off required before publishing'), { status: 422 });
  }

  const n = await schedQ.publish(cutoffId, subdeptId, ctx.user_id, 'manual');
  if (!n) throw Object.assign(new Error('Publish failed — schedule may already be published'), { status: 409 });

  bus.emit('SCHEDULE_PUBLISHED', { cutoffId, subdeptId, publishedBy: ctx.user_id });
}

async function getShifts(ctx) {
  return schedQ.getShifts(ctx.company_id);
}

async function getSlots(subdeptId) {
  return schedQ.getSlots(subdeptId);
}

async function getCutoffs(ctx) {
  return schedQ.getCutoffs(ctx.company_id);
}

module.exports = { getGrid, saveCell, saveCells, submitForReview, noteByOpHead, publish, getShifts, getSlots, getCutoffs };
