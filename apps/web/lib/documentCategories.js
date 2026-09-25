// The universal 3-tier document taxonomy — ids mirror the DocumentCategory
// enum in apps/api/prisma/schema.prisma (and services/shared/documentCategory.js).
// Shared by the self-serve wizard (pages/register.js) and the super-admin
// Documents tab (pages/tenants/[tenantId].js).
export const DOC_CATEGORIES = [
  {
    id: 'CORE_OVERVIEW',
    label: 'Company Overview & Core Info',
    short: 'Overview',
    hint: 'Who you are, what you offer, and why customers choose you. Both bots use this for background; the Sales Bot leans on it most.'
  },
  {
    id: 'FAQ',
    label: 'Frequently Asked Questions',
    short: 'FAQs',
    hint: 'Questions customers actually ask, with your answers. The Support Bot checks these first.'
  },
  {
    id: 'CUSTOM_POLICY',
    label: 'Custom / Policies / Pricing / Manuals',
    short: 'Policies & pricing',
    hint: 'Prices, plans, terms, returns, warranties, manuals. Treated as the authoritative source for money and rules questions.'
  }
];

export const DEFAULT_CATEGORY = 'CORE_OVERVIEW';

export function categoryLabel(id) {
  return DOC_CATEGORIES.find((c) => c.id === id)?.short || 'Overview';
}
