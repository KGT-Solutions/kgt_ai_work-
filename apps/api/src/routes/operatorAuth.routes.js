const express = require('express');
const prisma = require('../lib/prisma');
const { verifyPassword } = require('../utils/password');
const { createIpRateLimiter } = require('../utils/ipRateLimit');
const { requireOperator, signOperatorToken } = require('../middleware/operatorAuth');

// Operator console sign-in. Email + password only; operators are created by
// prisma/seed.js (HUB_ADMIN_EMAIL / HUB_ADMIN_PASSWORD).
const router = express.Router();

const isLoginRateLimited = createIpRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

router.post('/login', async (req, res) => {
  if (isLoginRateLimited(req.ip)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Please wait a few minutes and try again.' });
  }
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const operator = await prisma.operator.findUnique({ where: { email } });
  // Same message for an unknown email and a wrong password, so the response
  // doesn't reveal which operator accounts exist.
  if (!operator || !verifyPassword(password, operator.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  res.json({
    token: signOperatorToken(operator),
    operator: { id: operator.id, email: operator.email, name: operator.name }
  });
});

router.get('/me', requireOperator, (req, res) => {
  res.json({ operator: req.operator });
});

module.exports = router;
