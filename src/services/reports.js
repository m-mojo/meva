const reportsQ = require('../db/queries/reports');

async function timekeepingSummary(cutoffId, subdeptId, ctx) {
  return reportsQ.getTimekeepingSummary(cutoffId, ctx.company_id, subdeptId || null);
}

async function payrollDataView(cutoffId, subdeptId, ctx) {
  return reportsQ.getPayrollDataView(cutoffId, ctx.company_id, subdeptId || null);
}

async function logExport(params, ctx) {
  return reportsQ.logExport({ ...params, companyId: ctx.company_id, exportedBy: ctx.user_id });
}

module.exports = { timekeepingSummary, payrollDataView, logExport };
