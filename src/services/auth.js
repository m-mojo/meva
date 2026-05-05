const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { jwtSecret } = require('../config/env');
const authQ  = require('../db/queries/auth');

const ROLE_BY_POSITION = {
  'hr head':                     'hr',
  'finance & accounting head':   'admin',
  'system & network officer':    'it',
  'food & beverage coordinator': 'coord',
  'senior duty officer':         'coord',
};

function suggestRoleByPosition(positionName) {
  if (!positionName) return null;
  return ROLE_BY_POSITION[positionName.toLowerCase().trim()] ?? null;
}

async function login(username, password) {
  const user = await authQ.findByUsername(username);
  if (!user || !user.is_active) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

  const subDeptAccess = user.sub_dept_access_raw
    ? user.sub_dept_access_raw.split(',').map(Number)
    : [];

  const payload = {
    user_id:         user.user_acc_id,
    employee_id:     user.employee_id ?? null,
    role:            user.role,
    company_id:      user.company_id,
    sub_dept_access: subDeptAccess,
  };

  const token = jwt.sign(payload, jwtSecret, { expiresIn: '12h' });
  return { token, user: { ...payload, username: user.username } };
}

async function createUser({ username, password, role, companyId, subdeptIds = [], employeeId = null, positionName = null }, ctx) {
  const existing = await authQ.findByUsername(username);
  if (existing) throw Object.assign(new Error('Username already exists'), { status: 409 });

  const suggestedRole = suggestRoleByPosition(positionName);
  const resolvedRole = role || suggestedRole;
  if (!resolvedRole) throw Object.assign(new Error('role is required (or provide positionName for auto-suggestion)'), { status: 400 });

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = await authQ.create({ username, passwordHash, role: resolvedRole, companyId, employeeId, createdBy: ctx.user_id });

  if (subdeptIds.length) await authQ.setScope(userId, subdeptIds);

  return { user_id: userId, username, role: resolvedRole, company_id: companyId, suggested_role: suggestedRole };
}

async function updateScope(userId, subdeptIds, ctx) {
  await authQ.setScope(userId, subdeptIds);
}

async function deactivateUser(userId, ctx) {
  const n = await authQ.deactivate(userId, ctx.user_id);
  if (!n) throw Object.assign(new Error('User not found'), { status: 404 });
}

module.exports = { login, createUser, updateScope, deactivateUser, suggestRoleByPosition };
