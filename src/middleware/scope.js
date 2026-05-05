// Subdept access guard
// requireRole(...roles)        — 403 if user role not in list
// requireSubdept(paramName)    — 403 if coord user lacks access to the requested subdept
//
// Usage in routes:
//   router.get('/', requireRole('hr', 'super_admin'), handler)
//   router.get('/:subdept_id/...', requireSubdept('subdept_id'), handler)

function requireRole(...roles) {
  return function (req, res, next) {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient role' });
    }
    next();
  };
}

function requireSubdept(paramName = 'subdept_id') {
  return function (req, res, next) {
    if (req.user.role !== 'coord') return next(); // hr/super_admin/it/admin bypass subdept check

    const subdeptId = parseInt(req.params[paramName] ?? req.query[paramName] ?? '0', 10);
    if (!subdeptId) return next();

    if (!req.user.sub_dept_access.includes(subdeptId)) {
      return res.status(403).json({ success: false, error: 'Subdept access denied' });
    }
    next();
  };
}

module.exports = { requireRole, requireSubdept };
