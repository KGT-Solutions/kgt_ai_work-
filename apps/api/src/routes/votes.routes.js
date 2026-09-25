const express = require('express');
const prisma = require('../lib/prisma');
const { requireRole } = require('../middleware/rbac');
const { notifyAllResidents } = require('../utils/notifications');
const { emailAllResidents, pollCreatedEmail, pollResultsEmail } = require('../utils/emailNotify');
const router = express.Router();

async function getTotalMembers(buildingId) {
  return prisma.membership.count({
    where: { buildingId, status: 'approved', role: { key: 'resident' } }
  });
}

function formatVote(vote, userId, totalMembers) {
  const allResponses = vote.options.flatMap((o) => o.responses);
  const uniqueVoters = new Set(allResponses.map((r) => r.userId));
  const totalVoted = uniqueVoters.size;
  const userResponse = userId ? allResponses.find((r) => r.userId === userId) : null;
  const closesAt = new Date(vote.closesAt);
  const isOpen = closesAt > new Date();
  const msLeft = closesAt.getTime() - Date.now();
  const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));

  return {
    id: vote.id,
    question: vote.question,
    closesAt: vote.closesAt,
    isOpen,
    daysLeft,
    totalMembers,
    totalVoted,
    turnoutPct: totalMembers ? Math.round((totalVoted / totalMembers) * 100) : 0,
    userOptionId: userResponse?.voteOptionId || null,
    options: vote.options.map((o) => ({
      id: o.id,
      label: o.label,
      count: o.responses.length,
      pct: totalVoted ? Math.round((o.responses.length / totalVoted) * 100) : 0
    }))
  };
}

router.get('/', requireRole('resident', 'building_admin', 'committee_member'), async (req, res) => {
  const totalMembers = await getTotalMembers(req.buildingId);
  const votes = await prisma.vote.findMany({
    where: { buildingId: req.buildingId },
    include: { options: { include: { responses: { select: { userId: true } } } } },
    orderBy: { closesAt: 'desc' }
  });
  res.json(votes.map((v) => formatVote(v, req.user.id, totalMembers)));
});

router.post('/', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const { question, closesAt, options } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'question is required' });
  if (!closesAt) return res.status(400).json({ error: 'closesAt is required' });

  const labels = Array.isArray(options) && options.length >= 2
    ? options.map((o) => String(o).trim()).filter(Boolean)
    : ['Yes', 'No'];

  const vote = await prisma.vote.create({
    data: {
      buildingId: req.buildingId,
      question: question.trim(),
      closesAt: new Date(closesAt),
      options: { create: labels.map((label) => ({ label })) }
    },
    include: { options: { include: { responses: { select: { userId: true } } } } }
  });

  const daysLeft = Math.max(1, Math.ceil((new Date(closesAt) - Date.now()) / (24 * 60 * 60 * 1000)));
  await notifyAllResidents(prisma, req.buildingId, {
    title: 'New society poll',
    body: `${question.trim()} — voting open for ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
    category: 'general'
  });

  const building = await prisma.building.findUnique({
    where: { id: req.buildingId },
    select: { name: true }
  });
  await emailAllResidents(
    prisma,
    req.buildingId,
    pollCreatedEmail({
      question: question.trim(),
      daysLeft,
      buildingName: building?.name || 'Your society'
    })
  );

  const totalMembers = await getTotalMembers(req.buildingId);
  res.json(formatVote(vote, null, totalMembers));
});

router.patch('/:id', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const vote = await prisma.vote.findFirst({
    where: { id: req.params.id, buildingId: req.buildingId },
    include: { options: { include: { responses: { select: { userId: true } } } } }
  });
  if (!vote) return res.status(404).json({ error: 'Poll not found' });

  const { question, closesAt, end, options } = req.body;
  const hasVotes = vote.options.some((o) => o.responses.length > 0);
  const data = {};

  if (question?.trim()) data.question = question.trim();
  if (end) data.closesAt = new Date();
  else if (closesAt) data.closesAt = new Date(closesAt);

  if (Object.keys(data).length) {
    await prisma.vote.update({ where: { id: vote.id }, data });
  }

  if (Array.isArray(options) && options.length >= 2 && !hasVotes) {
    const labels = options.map((o) => String(o).trim()).filter(Boolean);
    if (labels.length >= 2) {
      await prisma.voteResponse.deleteMany({ where: { voteOptionId: { in: vote.options.map((o) => o.id) } } });
      await prisma.voteOption.deleteMany({ where: { voteId: vote.id } });
      await prisma.voteOption.createMany({ data: labels.map((label) => ({ voteId: vote.id, label })) });
    }
  }

  const updated = await prisma.vote.findUnique({
    where: { id: vote.id },
    include: { options: { include: { responses: { select: { userId: true } } } } }
  });
  const totalMembers = await getTotalMembers(req.buildingId);
  const formatted = formatVote(updated, null, totalMembers);

  // When admin ends a poll, publish results to all residents
  if (end) {
    await notifyAllResidents(prisma, req.buildingId, {
      title: 'Poll results published',
      body: updated.question,
      category: 'general'
    });
    const building = await prisma.building.findUnique({
      where: { id: req.buildingId },
      select: { name: true }
    });
    await emailAllResidents(
      prisma,
      req.buildingId,
      pollResultsEmail({
        question: updated.question,
        buildingName: building?.name || 'Your society',
        options: formatted.options
      })
    );
  }

  res.json(formatted);
});

router.delete('/:id', requireRole('building_admin', 'committee_member'), async (req, res) => {
  const vote = await prisma.vote.findFirst({
    where: { id: req.params.id, buildingId: req.buildingId },
    include: { options: true }
  });
  if (!vote) return res.status(404).json({ error: 'Poll not found' });

  const optionIds = vote.options.map((o) => o.id);
  if (optionIds.length) {
    await prisma.voteResponse.deleteMany({ where: { voteOptionId: { in: optionIds } } });
    await prisma.voteOption.deleteMany({ where: { voteId: vote.id } });
  }
  await prisma.vote.delete({ where: { id: vote.id } });
  res.json({ ok: true });
});

router.post('/:voteId/options/:optionId/respond', requireRole('resident'), async (req, res) => {
  const vote = await prisma.vote.findFirst({
    where: { id: req.params.voteId, buildingId: req.buildingId },
    include: { options: { include: { responses: { select: { userId: true } } } } }
  });
  if (!vote) return res.status(404).json({ error: 'Poll not found' });
  if (new Date(vote.closesAt) <= new Date()) {
    return res.status(400).json({ error: 'This poll has closed' });
  }

  const option = vote.options.find((o) => o.id === req.params.optionId);
  if (!option) return res.status(404).json({ error: 'Option not found' });

  const optionIds = vote.options.map((o) => o.id);
  await prisma.voteResponse.deleteMany({
    where: { userId: req.user.id, voteOptionId: { in: optionIds } }
  });
  await prisma.voteResponse.create({
    data: { voteOptionId: option.id, userId: req.user.id }
  });

  const updated = await prisma.vote.findUnique({
    where: { id: vote.id },
    include: { options: { include: { responses: { select: { userId: true } } } } }
  });
  const totalMembers = await getTotalMembers(req.buildingId);
  res.json(formatVote(updated, req.user.id, totalMembers));
});

module.exports = router;
