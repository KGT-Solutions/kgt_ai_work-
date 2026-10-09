// Which bot may use a document — ids mirror the BotScope enum in
// apps/api/prisma/schema.prisma (and services/shared/botScope.js). AUTO lets
// the API classify each section of the document on its own.
export const BOT_SCOPES = [
  { id: 'AUTO', label: 'Auto-detect', short: 'Auto', hint: 'Each section goes to the bot it fits: pricing to Sales, troubleshooting to Support, company basics to both.' },
  { id: 'BOTH', label: 'Both bots', short: 'Both', hint: 'Every section is available to the Support and the Sales Bot.' },
  { id: 'SUPPORT', label: 'Support Bot only', short: 'Support', hint: 'Manuals, FAQs, policies: only the Support Bot answers from it.' },
  { id: 'SALES', label: 'Sales Bot only', short: 'Sales', hint: 'Pricing, plans, pitch material: only the Sales Bot answers from it.' }
];

export const DEFAULT_BOT_SCOPE = 'AUTO';

export const botScopeLabel = (id) => BOT_SCOPES.find((s) => s.id === id)?.short || 'Auto';

// Section-level scopes returned by GET /knowledge/distribution.
export const SECTION_SCOPES = {
  support: { label: 'Support only', tone: 'blue' },
  sales: { label: 'Sales only', tone: 'green' },
  both: { label: 'Both bots', tone: 'neutral' }
};
