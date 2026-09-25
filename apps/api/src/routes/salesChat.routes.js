const express = require('express');
const { getSalesAnswer } = require('../services/salesbot/salesBot');

const router = express.Router();

const ALLOWED_CLIENT_TYPES = new Set(['builder', 'rwa_president', 'committee_member']);
const MAX_QUERY_LEN = 1000;

// This endpoint is intentionally public (prospects aren't logged-in FLATBRIZ
// users), so rate limiting is keyed by IP rather than by user id.
const RATE_LIMIT_MAX = Number(process.env.SALES_CHAT_RATE_LIMIT_MAX || 20);
const RATE_LIMIT_WINDOW_MS = Number(process.env.SALES_CHAT_RATE_LIMIT_WINDOW_MIN || 10) * 60 * 1000;
const requestLog = new Map(); // ip -> timestamps[]

function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (requestLog.get(ip) || []).filter((t) => t > windowStart);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX;
}

router.post('/sales', async (req, res, next) => {
  try {
    const query = String(req.body?.query || '').trim();
    const clientType = String(req.body?.clientType || '').trim().toLowerCase();

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }
    if (query.length > MAX_QUERY_LEN) {
      return res.status(400).json({ error: `query must be ${MAX_QUERY_LEN} characters or fewer` });
    }
    if (!ALLOWED_CLIENT_TYPES.has(clientType)) {
      return res
        .status(400)
        .json({ error: 'clientType must be one of: builder, rwa_president, committee_member' });
    }

    if (isRateLimited(req.ip)) {
      return res.status(429).json({
        error: 'Too many chat requests. Please wait a few minutes and try again.'
      });
    }

    const { answer, keyBenefitsHighlighted, suggestedFollowUp } = await getSalesAnswer({
      query,
      clientType
    });
    res.json({ answer, keyBenefitsHighlighted, suggestedFollowUp });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
