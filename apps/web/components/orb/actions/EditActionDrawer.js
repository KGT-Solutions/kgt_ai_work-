import { useState } from 'react';
import { Drawer, Field, Input, Textarea, Select, Button, Pill, Checkbox, IconClose, IconPlus, IconDrag } from '..';

// Right drawer: edit an action (name, trigger phrases, requested fields, effects,
// visitor message, counts-as). Presentational with internal form state.
// props: open, onClose, action { title, subtitle }

function PhraseChip({ label, onRemove }) {
  return (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-orb-stroke bg-orb-white px-2.5 orb-small-medium text-orb-ink">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="text-orb-tertiary transition-colors hover:text-orb-ink focus:outline-none"><IconClose size={12} /></button>
    </span>
  );
}

const DEFAULT_PHRASES = ['book an appointment', 'see a doctor', 'first visit', 'consultation'];
const FIELDS = [
  { id: 'name', label: 'Name', type: 'Text', required: true },
  { id: 'phone', label: 'Phone', type: 'Phone number', required: true },
  { id: 'branch', label: 'Branch', type: 'Kharadi, Baner or Wakad', required: true },
  { id: 'day', label: 'Preferred day', type: 'Date', required: false }
];

export default function EditActionDrawer({ open, onClose, action = {} }) {
  const [name, setName] = useState(action.title || 'Book a first consultation');
  const [phrases, setPhrases] = useState(DEFAULT_PHRASES);
  const [happens, setHappens] = useState([
    { id: 'cal', label: 'Book a slot in the branch calendar', integration: 'Google Calendar', checked: true },
    { id: 'crm', label: 'Add the lead to Zoho CRM', integration: 'Zoho CRM', checked: true },
    { id: 'email', label: 'Email the front desk', integration: 'Email', checked: false }
  ]);
  const [after, setAfter] = useState("You're booked at Sanvi {branch} on {day}. The front desk will call to confirm within 2 hours.");
  const [countsAs, setCountsAs] = useState('booked');

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <Button>Test this action</Button>
      <div className="flex gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={onClose}>Save changes</Button>
      </div>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} width={540} title="Edit action" description={action.subtitle || 'Book a first consultation · on · 58 booked in the last 7 days'} footer={footer}>
      <div className="flex flex-col gap-5">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>

        <div>
          <p className="orb-small-medium text-orb-secondary">Orb offers it when a visitor asks…</p>
          <p className="mt-0.5 orb-small text-orb-secondary">Phrases, not exact matches. Orb also offers it when the meaning is the same.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {phrases.map((p) => <PhraseChip key={p} label={p} onRemove={() => setPhrases((xs) => xs.filter((x) => x !== p))} />)}
            <button type="button" className="inline-flex h-7 items-center gap-1 rounded-lg border border-dashed border-orb-stroke px-2.5 orb-small-medium text-orb-secondary transition-colors hover:border-orb-ink hover:text-orb-ink focus:outline-none">
              <IconPlus size={12} /> Add a phrase
            </button>
          </div>
        </div>

        <div>
          <p className="mb-2 orb-small-medium text-orb-secondary">What Orb asks for</p>
          <div className="divide-y divide-orb-hairline overflow-hidden rounded-xl border border-orb-hairline">
            {FIELDS.map((f) => (
              <div key={f.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="cursor-grab text-orb-tertiary"><IconDrag size={16} /></span>
                <span className="orb-body-strong text-orb-ink">{f.label}</span>
                <span className="orb-small text-orb-secondary">{f.type}</span>
                <span className="ml-auto"><Pill tone="neutral">{f.required ? 'Required' : 'Optional'}</Pill></span>
              </div>
            ))}
          </div>
          <button type="button" className="mt-2 inline-flex items-center gap-1 orb-small-medium text-orb-ink hover:underline focus:outline-none"><IconPlus size={14} /> Add a field</button>
        </div>

        <div>
          <p className="mb-2 orb-small-medium text-orb-secondary">What happens</p>
          <div className="flex flex-col gap-2.5">
            {happens.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3">
                <Checkbox checked={h.checked} onChange={() => setHappens((hs) => hs.map((x) => (x.id === h.id ? { ...x, checked: !x.checked } : x)))}>
                  <span className="orb-body text-orb-ink">{h.label}</span>
                </Checkbox>
                <span className="shrink-0 orb-small text-orb-secondary">{h.integration}</span>
              </div>
            ))}
          </div>
        </div>

        <Field label="What the visitor sees after">
          <Textarea value={after} onChange={(e) => setAfter(e.target.value)} rows={2} />
        </Field>

        <div>
          <p className="orb-small-medium text-orb-secondary">Counts as</p>
          <p className="mt-0.5 orb-small text-orb-secondary">Shows up as Booked on Overview and in Leads &amp; bookings.</p>
          <div className="mt-2">
            <Select value={countsAs} onChange={(e) => setCountsAs(e.target.value)} options={[{ value: 'booked', label: 'Booked' }, { value: 'lead', label: 'Lead' }, { value: 'handoff', label: 'Handoff' }]} />
          </div>
        </div>
      </div>
    </Drawer>
  );
}
