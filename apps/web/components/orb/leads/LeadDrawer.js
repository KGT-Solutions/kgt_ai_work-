import { useState } from 'react';
import { Drawer, Button, Pill, Select, IconSpark } from '..';

// Right drawer: a single lead/booking. props: open, onClose, lead
function Row({ label, value, action, onAction }) {
  return (
    <div className="grid grid-cols-[120px_1fr_auto] items-center gap-3 border-b border-orb-hairline py-2.5 last:border-b-0">
      <span className="orb-small text-orb-secondary">{label}</span>
      <span className="orb-body text-orb-ink">{value}</span>
      {action && <button type="button" onClick={onAction} className="orb-small-medium text-orb-ink hover:underline focus:outline-none">{action}</button>}
    </div>
  );
}

const Section = ({ title, children }) => (
  <div className="mt-5 first:mt-0">
    <p className="mb-1 orb-body-strong text-orb-ink">{title}</p>
    {children}
  </div>
);

export default function LeadDrawer({ open, onClose, lead }) {
  const [status, setStatus] = useState(lead?.status || 'booked');
  if (!lead) return null;

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <Button>Open conversation</Button>
      <Button variant="primary">Mark as showed up</Button>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} width={540} title={<span className="inline-flex items-center gap-2">{lead.name} {lead.statusPill && <Pill tone={lead.statusPill.tone}>{lead.statusPill.label}</Pill>}</span>} description={lead.subtitle} footer={footer}>
      <div className="flex flex-col">
        <div className="flex flex-wrap items-center gap-3 pb-4">
          <span className="orb-small text-orb-secondary">Status</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: 'new', label: 'New' }, { value: 'contacted', label: 'Contacted' }, { value: 'booked', label: 'Booked' }, { value: 'showed', label: 'Showed up' }]} />
          <span className="orb-small text-orb-tertiary">New, Contacted, Booked, Showed up</span>
        </div>

        <Section title="Contact">
          <Row label="Phone" value={lead.contact?.phone} action={lead.contact?.phone && lead.contact.phone !== 'Not given' ? 'Copy' : undefined} />
          <Row label="Email" value={lead.contact?.email} />
          <Row label="Language" value={lead.contact?.language} />
        </Section>

        <Section title="Booking">
          <Row label="Branch" value={lead.booking?.branch} />
          <Row label="Day and time" value={lead.booking?.dayTime} />
          <Row label="Confirmation" value={lead.booking?.confirmation} />
        </Section>

        {lead.summary && (
          <div className="mt-5 rounded-xl bg-orb-subtle px-4 py-3">
            <p className="flex items-center gap-1.5 orb-small-strong text-orb-ink"><IconSpark size={14} /> AI summary <span className="orb-small text-orb-secondary">· {lead.summaryMeta}</span></p>
            <p className="mt-1.5 orb-small text-orb-secondary">{lead.summary}</p>
          </div>
        )}

        <Section title="Where it went">
          {lead.whereWent?.map((r, i) => <Row key={i} label={r.label} value={r.value} action={r.action} />)}
        </Section>

        <Section title="From this chat">
          {lead.fromChat?.map((r, i) => <Row key={i} label={r.label} value={r.value} action={r.action} />)}
        </Section>
      </div>
    </Drawer>
  );
}
