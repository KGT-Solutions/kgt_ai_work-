// Which bots a company deploys — mirrors Tenant.botPreference in the API
// (services/shared/botScope.js). Shared by the signup wizard's
// "Choose your AI workforce" step and the workspace Overview.
export const BOT_PREFERENCES = [
  {
    id: 'support',
    emoji: '🤝',
    title: 'Support Bot',
    tagline: 'For your existing customers',
    description: 'Specialized in answering troubleshooting questions, operating hours, FAQs, and handling customer service tickets gracefully with automated handoffs.',
    points: ['Step-by-step troubleshooting', 'Policies, hours & FAQs', 'Hands off to your team when unsure']
  },
  {
    id: 'sales',
    emoji: '💼',
    title: 'Sales Bot',
    tagline: 'For prospects & new buyers',
    description: 'Specialized in explaining pricing, product tiers, feature comparisons, objection handling, and capturing lead inquiries.',
    points: ['Pricing & plan comparisons', 'Objection handling', 'Captures leads for your team']
  },
  {
    id: 'both',
    emoji: '🚀',
    title: 'Both',
    tagline: 'Complete AI workforce',
    recommended: true,
    description: 'Deploys both specialized agents with automated knowledge separation so prospects get sales answers and customers get support answers.',
    points: ['Two specialists, one knowledge base', 'Automatic Sales / Support split', 'Every visitor gets the right expert']
  }
];

export const DEFAULT_BOT_PREFERENCE = 'both';

/** The bots a preference deploys: 'both' -> ['support', 'sales']. */
export const botsFor = (preference) => (preference === 'support' || preference === 'sales' ? [preference] : ['support', 'sales']);

export const botPreferenceLabel = (id) => ({ support: 'Support Bot only', sales: 'Sales Bot only', both: 'Support & Sales Bots' }[id] || 'Support & Sales Bots');
