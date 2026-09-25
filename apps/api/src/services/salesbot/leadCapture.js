const prisma = require('../../lib/prisma');
const { sendToEmails, salesLeadEmail } = require('../../utils/emailNotify');

function alertRecipients() {
  const combined = [process.env.SALES_LEAD_EMAIL, process.env.SALES_EMAIL, process.env.CHAT_ALERT_EMAIL]
    .filter(Boolean)
    .join(',');
  return [...new Set(
    combined
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  )];
}

/**
 * Persists every sales inquiry for later review, and — for high buying-intent
 * messages only — emails the configured sales recipients so a human can
 * follow up promptly. Never throws: a lead-capture failure must not break
 * the chat response.
 * @param {{
 *   clientType: string, query: string, answer: string,
 *   intentScore: number, isHighIntent: boolean, signals: string[]
 * }} params
 */
async function captureLead({ clientType, query, answer, intentScore, isHighIntent, signals }) {
  try {
    const lead = await prisma.salesLead.create({
      data: { clientType, query, answer, intentScore, signals }
    });

    if (!isHighIntent) return { logged: true, alerted: false };

    const recipients = alertRecipients();
    if (!recipients.length) {
      console.log('[sales-lead] High-intent lead but no SALES_LEAD_EMAIL/SALES_EMAIL configured');
      return { logged: true, alerted: false };
    }

    const result = await sendToEmails(
      recipients,
      salesLeadEmail({ clientType, query, answer, intentScore, signals })
    );

    if (result.sent > 0) {
      await prisma.salesLead.update({ where: { id: lead.id }, data: { alerted: true } });
    }

    return { logged: true, alerted: result.sent > 0 };
  } catch (err) {
    console.error('[sales-lead] captureLead failed:', err.message);
    return { logged: false, alerted: false };
  }
}

module.exports = { captureLead };
