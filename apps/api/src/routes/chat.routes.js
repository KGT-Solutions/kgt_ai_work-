const express = require('express');
const { getSupportAnswer } = require('../services/chatbot/supportBot');

const router = express.Router();

const ALLOWED_ROLES = new Set(['resident', 'admin', 'guard']);
const MAX_QUERY_LEN = 1000;

// Simple in-memory sliding-window rate limit per user, to bound LLM spend.
// Fine for a single-process deployment; move to a shared store (Redis) if
// the API ever runs multiple instances.
const RATE_LIMIT_MAX = Number(process.env.CHAT_RATE_LIMIT_MAX || 20);
const RATE_LIMIT_WINDOW_MS = Number(process.env.CHAT_RATE_LIMIT_WINDOW_MIN || 10) * 60 * 1000;
const requestLog = new Map(); // userId -> timestamps[]

function isRateLimited(userId) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestLog.get(userId) || []).filter((t) => t > windowStart);
  timestamps.push(now);
  requestLog.set(userId, timestamps);

  // Every distinct user who has ever sent one message otherwise leaves a
  // permanent Map entry for the process lifetime. Occasional, cheap sweep of
  // now-empty entries — not exact, just bounds the leak.
  if (requestLog.size > 5000 && Math.random() < 0.01) {
    for (const [key, arr] of requestLog) {
      if (!arr.some((t) => t > windowStart)) requestLog.delete(key);
    }
  }

  return timestamps.length > RATE_LIMIT_MAX;
}

router.post('/support', async (req, res, next) => {
  try {
    const query = String(req.body?.query || '').trim();
    const userRole = String(req.body?.userRole || '').trim().toLowerCase();

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }
    if (query.length > MAX_QUERY_LEN) {
      return res.status(400).json({ error: `query must be ${MAX_QUERY_LEN} characters or fewer` });
    }
    if (!ALLOWED_ROLES.has(userRole)) {
      return res.status(400).json({ error: 'userRole must be one of: resident, admin, guard' });
    }

    if (isRateLimited(req.user.id)) {
      return res.status(429).json({
        error: 'Too many chat requests. Please wait a few minutes and try again.'
      });
    }

    const buildingId = req.headers['x-building-id'] || null;
    const { answer, sourceSection } = await getSupportAnswer({
      query,
      userRole,
      buildingId,
      userId: req.user.id
    });
    res.json({ answer, sourceSection });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
