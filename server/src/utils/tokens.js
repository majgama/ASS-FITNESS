import crypto from 'node:crypto';

export function createToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createInviteCode(prefix = 'FIT') {
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}
