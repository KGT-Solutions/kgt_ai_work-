import { Field, Input, Select, Button } from '..';
import { OrbFormCard } from '../auth';

// Step 2 (Figma 0C): about the company. Controlled via the lifted `company`
// state. industry drives both the human industryLabel (stored) and, at
// /complete, the API businessCategory (see lib/onboarding.js →
// businessCategoryFor). The category list + "We'll ask you to add…" hint mirror
// the existing signup step (pages/register.js → BUSINESS_CATEGORIES).
const CATEGORIES = [
  { value: 'ecommerce', label: 'E-commerce / Retail', asksFor: 'a product catalog or inventory sheet (CSV), plus returns and shipping policies' },
  { value: 'saas', label: 'SaaS / Tech', asksFor: 'product and API documentation, feature guides, and pricing tiers' },
  { value: 'healthcare', label: 'Healthcare', asksFor: 'services offered, patient FAQs, and policies' },
  { value: 'real_estate', label: 'Real Estate', asksFor: 'listings, pricing, and process/policy documents' },
  { value: 'services', label: 'Services', asksFor: 'service descriptions and terms, FAQs, and company policies' },
  { value: 'other', label: 'Other', asksFor: 'an overview, FAQs, and your key policies' }
];

export default function CompanyStep({ company, setCompany, onBack, onContinue }) {
  const set = (k) => (e) => setCompany((c) => ({ ...c, [k]: e.target.value }));
  const onIndustry = (e) => {
    const value = e.target.value;
    const label = CATEGORIES.find((i) => i.value === value)?.label || '';
    setCompany((c) => ({ ...c, industry: value, industryLabel: label }));
  };
  const valid = company.companyName.trim();
  const category = CATEGORIES.find((c) => c.value === company.industry) || CATEGORIES.at(-1);

  return (
    <OrbFormCard
      title="Set up Orb for your company"
      subtitle="Orb introduces itself with your company’s name. All three are needed."
      footer={(
        <div className="flex items-center justify-between gap-3">
          <Button onClick={onBack}>Back</Button>
          <div className="flex items-center gap-3">
            <span className="orb-small text-orb-secondary">Your progress is saved from this step on.</span>
            <Button variant="primary" size="md" onClick={onContinue} disabled={!valid}>Continue</Button>
          </div>
        </div>
      )}
    >
      <div className="flex flex-col gap-5">
        <Field label="Company name"><Input value={company.companyName} onChange={set('companyName')} placeholder="Sanvi Fertility & IVF" /></Field>
        <Field label="Your name" helper="Shown to your team, not to patients."><Input value={company.contactName} onChange={set('contactName')} placeholder="Nikita Deshpande" /></Field>
        <Field label="Business category / industry" helper={`We’ll ask you to add ${category.asksFor}.`}>
          <Select fullWidth size="md" value={company.industry} onChange={onIndustry} ariaLabel="Business category / industry" options={CATEGORIES} />
        </Field>
      </div>
    </OrbFormCard>
  );
}
