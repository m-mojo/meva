const reqQ = require('../db/queries/requests');
const bus  = require('../notifications/bus');

async function list(params, ctx) {
  return reqQ.findByStatus(ctx.company_id, params.status || 'pending', params.form_type || null);
}

async function get(formUploadId, ctx) {
  const form = await reqQ.findById(formUploadId, ctx.company_id);
  if (!form) throw Object.assign(new Error('Form not found'), { status: 404 });
  return form;
}

async function submit(data, ctx) {
  if (!data.form_type)    throw Object.assign(new Error('form_type is required'), { status: 400 });
  if (!data.employee_id) throw Object.assign(new Error('employee_id is required'), { status: 400 });

  const formId = await reqQ.create(data, ctx.user_id);

  bus.emit('FORM_SUBMITTED', { formId, formType: data.form_type, submittedBy: ctx.user_id, companyId: ctx.company_id });
  return { form_upload_id: formId };
}

async function approve(formUploadId, ctx) {
  const n = await reqQ.approve(formUploadId, ctx.user_id);
  if (!n) throw Object.assign(new Error('Form not found or already processed'), { status: 409 });
  bus.emit('FORM_APPROVED', { formUploadId, approvedBy: ctx.user_id, companyId: ctx.company_id });
}

async function deny(formUploadId, ctx) {
  const n = await reqQ.deny(formUploadId, ctx.user_id);
  if (!n) throw Object.assign(new Error('Form not found'), { status: 404 });
  bus.emit('FORM_DENIED', { formUploadId, deniedBy: ctx.user_id, companyId: ctx.company_id });
}

module.exports = { list, get, submit, approve, deny };
