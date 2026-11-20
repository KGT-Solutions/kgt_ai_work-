import { Field, Input, Select, Button } from '..';
import { OrbFormCard } from '../auth';

// Step 2 (Figma 0C): about the clinic.
export default function CompanyStep({ onContinue }) {
  return (
    <OrbFormCard
      title="About your clinic"
      subtitle="Orb introduces itself with your clinic’s name. All three are needed."
      footer={(
        <div className="flex items-center justify-between gap-3">
          <span className="orb-small text-orb-secondary">Your progress is saved from this step on.</span>
          <Button variant="primary" size="md" onClick={onContinue}>Continue</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-5">
        <Field label="Company name"><Input defaultValue="Sanvi Fertility & IVF" /></Field>
        <Field label="Your name" helper="Shown to your team, not to patients."><Input defaultValue="Nikita Deshpande" /></Field>
        <Field label="Industry" helper="Used to suggest what to add next: an overview, common patient questions, and your prices and policies.">
          <Select fullWidth size="md" defaultValue="fertility" ariaLabel="Industry" options={[{ value: 'fertility', label: 'Fertility & IVF clinic' }, { value: 'dental', label: 'Dental clinic' }, { value: 'general', label: 'General clinic' }, { value: 'other', label: 'Other' }]} />
        </Field>
      </div>
    </OrbFormCard>
  );
}
