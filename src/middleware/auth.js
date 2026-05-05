const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');

module.exports = function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }
  try {
    const payload = jwt.verify(header.slice(7), jwtSecret);
    req.user = {
      user_id:         payload.user_id,
      employee_id:     payload.employee_id ?? null,
      role:            payload.role,
      company_id:      payload.company_id,
      sub_dept_access: payload.sub_dept_access || [],
    };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};
