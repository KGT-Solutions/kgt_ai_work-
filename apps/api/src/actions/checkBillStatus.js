const prisma = require('../lib/prisma');
const { registerAction } = require('../engine/actionRegistry');

// A real example of Requirement 3's payoff: "what do I owe" isn't a
// documentation question — the manual can only explain *how* paying works
// (see docs/manuals/resident-manual.md), never a live number. This action
// answers it directly from the Bill table and bypasses RAG/the LLM
// entirely, matching the user's real question instead of the closest
// paragraph about it.

// A query asking for a live NUMBER ("what do I owe") should trigger this
// action. A query asking HOW to do something ("how do I pay my bill") should
// NOT — that's answered correctly by the manual's payment instructions, and
// the two used to collide: "how do I pay my maintenance bill" matched the
// old broad `/my (bill|dues|maintenance)/i` pattern and incorrectly
// short-circuited straight to a balance readout instead of the payment
// steps. Exclusions run first and win even when a balance pattern would
// otherwise also match.
const PROCEDURAL_EXCLUSIONS = [
  /how (do|can|to) i pay/i,
  /how to pay/i,
  /where (do|can) i pay/i,
  /how do i (submit|upload|confirm) (a |my )?payment/i
];

const BALANCE_TRIGGER_PATTERNS = [
  /how much.*(owe|due)/i,
  /what.*i owe/i,
  /outstanding (bill|amount|dues|balance)/i,
  /pending (bill|amount|dues|payment)/i,
  /(is|are) my (bill|dues|maintenance).*(paid|due|pending|outstanding)/i,
  /(my )?(bill|dues|maintenance).*(status|balance)/i,
  /do i (have|owe) any (pending|outstanding)/i
];

registerAction('checkBillStatus', {
  match(query, ctx) {
    if (!ctx.buildingId || !ctx.userId) return false;
    if (PROCEDURAL_EXCLUSIONS.some((re) => re.test(query))) return false;
    return BALANCE_TRIGGER_PATTERNS.some((re) => re.test(query));
  },

  async run(query, ctx) {
    const membership = await prisma.membership.findFirst({
      where: {
        userId: ctx.userId,
        buildingId: ctx.buildingId,
        status: 'approved',
        role: { key: 'resident' },
        flatId: { not: null }
      },
      select: { flatId: true }
    });
    if (!membership?.flatId) return null; // not a resident tied to a flat — fall through to RAG

    const bills = await prisma.bill.findMany({
      where: { buildingId: ctx.buildingId, flatId: membership.flatId, status: { in: ['due', 'partial'] } },
      orderBy: { dueDate: 'asc' }
    });

    if (!bills.length) {
      return { answer: 'You have no outstanding dues right now — all your bills are paid up.' };
    }

    const total = bills.reduce((sum, b) => sum + (b.amount - b.amountPaid), 0);
    const lines = bills.map(
      (b) =>
        `• ${b.title || b.month}: ₹${(b.amount - b.amountPaid).toLocaleString('en-IN')} — due ${new Date(
          b.dueDate
        ).toLocaleDateString('en-IN')}`
    );

    return {
      answer:
        `You have ${bills.length} outstanding bill${bills.length === 1 ? '' : 's'} totaling ` +
        `₹${total.toLocaleString('en-IN')}:\n\n${lines.join('\n')}\n\nOpen the Bills tab to pay.`
    };
  }
});

module.exports = {};
