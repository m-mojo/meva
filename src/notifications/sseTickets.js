const crypto = require('crypto');

const _store = new Map(); // token → { userId, companyId, expiresAt }

function _purge() {
  const now = Date.now();
  for (const [k, v] of _store) {
    if (now > v.expiresAt) _store.delete(k);
  }
}

function issue(userId, companyId) {
  _purge();
  const token = crypto.randomBytes(24).toString('hex');
  _store.set(token, { userId, companyId, expiresAt: Date.now() + 30_000 });
  return token;
}

// Single-use: consumes the ticket on first call. Returns null if missing or expired.
function consume(token) {
  if (!token) return null;
  const ticket = _store.get(token);
  if (!ticket) return null;
  _store.delete(token);
  if (Date.now() > ticket.expiresAt) return null;
  return ticket;
}

module.exports = { issue, consume };
