const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const verify = crypto.scryptSync(password, salt, 64).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verify, 'hex'));
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
