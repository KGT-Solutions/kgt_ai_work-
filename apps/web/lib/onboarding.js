// Onboarding API-integration layer for the Orb signup wizard (pages/orb-register).
//
// Thin TanStack Query mutation hooks over the public register endpoints in
// lib/api.js, plus the mappers that turn the wizard's local shapes into the
// request bodies POST /register/complete expects. Keeping this in one place
// means the step components never touch `api` or the request body shape
// directly — they call a hook and read { mutateAsync, isPending, error }.

import { useMutation } from '@tanstack/react-query';
import { api } from './api';
import { DEFAULT_BOT_SCOPE } from './botScopes';

// ── Mappers ────────────────────────────────────────────────────────────────

// The Orb Company step's industry <select> values → the API's businessCategory
// enum (ecommerce | saas | healthcare | real_estate | services | other). The
// raw label is sent separately as industryLabel.
const BUSINESS_CATEGORY_BY_INDUSTRY = {
  fertility: 'healthcare',
  dental: 'healthcare',
  general: 'healthcare',
  other: 'other'
};
export const businessCategoryFor = (industry) => BUSINESS_CATEGORY_BY_INDUSTRY[industry] || 'other';

// The two Training-step toggles → Tenant.botPreference.
export const botPreferenceFrom = ({ support, sales }) => {
  if (support && sales) return 'both';
  if (support) return 'support';
  if (sales) return 'sales';
  return 'both'; // neither on: fall back to the API default rather than send nothing
};

// A Knowledge-step entry → one API page. `kind` tells us where it came from so
// a scanned page carries its sourceUrl (which drives the crawl-consent rule).
export const entryToApiPage = (entry) => ({
  title: entry.title,
  content: entry.content || '',
  category: entry.category || 'CORE_OVERVIEW',
  botScope: entry.scope || DEFAULT_BOT_SCOPE,
  sourceUrl: entry.kind === 'website' ? entry.sourceUrl || undefined : undefined
});

// Assemble the full /complete body from the wizard's lifted state.
export const buildCompletePayload = ({ account, verification, company, bots, entries }) => {
  const pages = entries.map(entryToApiPage).filter((p) => p.title && p.content);
  const scanned = entries.find((e) => e.kind === 'website' && e.consentUrl);
  return {
    companyName: company.companyName?.trim(),
    contactName: company.contactName?.trim() || undefined,
    email: account.email?.trim(),
    password: account.password,
    industryLabel: company.industryLabel,
    businessCategory: businessCategoryFor(company.industry),
    botPreference: botPreferenceFrom(bots),
    pages,
    websiteConsent: scanned ? { authorized: true, url: scanned.consentUrl } : undefined,
    emailVerificationToken: verification?.token
  };
};

// ── Mutation hooks ───────────────────────────────────────────────────────────

// Step 1a/1b — email verification.
export const useSendOtp = () => useMutation({ mutationFn: (email) => api.sendSignupOtp(email) });
export const useVerifyOtp = () =>
  useMutation({ mutationFn: ({ email, otp }) => api.verifySignupOtp(email, otp) });

// Step 3 — knowledge analysis (nothing is persisted; both return { pages }).
export const useAnalyzeUrl = () =>
  useMutation({ mutationFn: ({ url, authorized }) => api.analyzeCompanyUrl(url, { authorized }) });
export const useAnalyzeFile = () => useMutation({ mutationFn: (file) => api.analyzeCompanyFile(file) });

// Step 4 — readiness audit of exactly the pages under review.
export const usePreflightAudit = () => useMutation({ mutationFn: (payload) => api.preflightAudit(payload) });

// Step 5 — create the tenant, key and login; returns the client token.
export const useCompleteRegistration = () =>
  useMutation({ mutationFn: (payload) => api.completeRegistration(payload) });
