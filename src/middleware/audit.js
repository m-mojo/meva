// Audit log writer — wraps res.json to append to tbl_audit_log after every successful write.
// Never throws. Failures are logged to console only.
const { queryWithRetry } = require('../config/db');

function auditLog(actionType, tableRef = null) {
  return function (req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (res.statusCode < 400 && req.user) {
        const recordId = body?.data?.id
                      ?? body?.data?.employee_id
                      ?? body?.data?.schedule_id
                      ?? body?.data?.batch_id
                      ?? null;
        queryWithRetry(
          `INSERT INTO tbl_audit_log
             (action_type, actor_id, actor_role, affected_employee_id,
              target_table, target_record_id, new_value, ip_address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            actionType,
            req.user.user_id,
            req.user.role,
            body?.data?.employee_id ?? null,
            tableRef,
            typeof recordId === 'string' ? null : recordId,
            JSON.stringify(req.body).slice(0, 2000),
            req.ip,
          ]
        ).catch(err => console.error('❌ [audit] write failed:', err.message));
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = auditLog;
