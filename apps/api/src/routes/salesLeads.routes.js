const express = require('express');
const prisma = require('../lib/prisma');

const router = express.Router();

const ALLOWED_CLIENT_TYPES = new Set(['builder', 'rwa_president', 'committee_member']);
const SORTABLE_FIELDS = new Set(['createdAt', 'intentScore']);
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function serializeLead(lead) {
  return {
    id: lead.id,
    query: lead.query,
    answer: lead.answer,
    clientType: lead.clientType,
    intentScore: lead.intentScore,
    // Combined objection/competitor/buying-signal tags detected on the inquiry —
    // see src/services/salesbot/intent.js for how these are derived.
    matchedObjections: lead.signals,
    notifiedViaEmail: lead.alerted,
    createdAt: lead.createdAt
  };
}

// GET /api/v1/sales-leads — Super Admin only. Paginated, sortable list of
// inquiries captured by the Sales Chatbot (src/services/salesbot/leadCapture.js).
router.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(req.query.pageSize) || DEFAULT_PAGE_SIZE));

  const sortBy = SORTABLE_FIELDS.has(req.query.sortBy) ? req.query.sortBy : 'createdAt';
  const order = req.query.order === 'asc' ? 'asc' : 'desc';

  const where = {};
  if (req.query.clientType) {
    const clientType = String(req.query.clientType).trim().toLowerCase();
    if (!ALLOWED_CLIENT_TYPES.has(clientType)) {
      return res.status(400).json({ error: 'clientType must be one of: builder, rwa_president, committee_member' });
    }
    where.clientType = clientType;
  }
  if (req.query.minIntentScore !== undefined) {
    const minIntentScore = Number(req.query.minIntentScore);
    if (!Number.isFinite(minIntentScore)) {
      return res.status(400).json({ error: 'minIntentScore must be a number' });
    }
    where.intentScore = { gte: minIntentScore };
  }

  const [leads, total] = await Promise.all([
    prisma.salesLead.findMany({
      where,
      orderBy: { [sortBy]: order },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.salesLead.count({ where })
  ]);

  res.json({
    leads: leads.map(serializeLead),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize))
  });
});

module.exports = router;
