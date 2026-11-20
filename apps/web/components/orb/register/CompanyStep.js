import { Field, Input, Select, Button } from '..';
import { OrbFormCard } from '../auth';

// Step 2 (Figma 0C): about the clinic. Controlled via the lifted `company` state.
// industry drives both the human industryLabel (stored) and, at /complete, the
// API businessCategory (see lib/onboarding.js → businessCategoryFor).
const INDUSTRIES = [
  { value: 'fertility', label: 'Fertility & IVF clinic' },
  { value: 'dental', label: 'Dental clinic' },
  { value: 'general', label: 'General clinic' },
  { value: 'other', label: 'Other' }
];

export default function CompanyStep({ company, setCompany, onBack, onContinue }) {
  const set = (k) => (e) => setCompany((c) => ({ ...c, [k]: e.target.value }));
  const onIndustry = (e) => {
    const value = e.target.value;
    const label = INDUSTRIES.find((i) => i.value === value)?.label || '';
    setCompany((c) => ({ ...c, industry: value, industryLabel: label }));
  };
  const valid = company.companyName.trim();

  return (
    <OrbFormCard
      title="About your clinic"
      subtitle="Orb introduces itself with your clinic’s name. All three are needed."
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
        <Field label="Industry" helper="Used to suggest what to add next: an overview, common patient questions, and your prices and policies.">
          <Select fullWidth size="md" value={company.industry} onChange={onIndustry} ariaLabel="Industry" options={INDUSTRIES} />
        </Field>
      </div>
    </OrbFormCard>
  );
}
