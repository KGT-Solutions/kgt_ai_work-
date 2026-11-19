import { useState } from 'react';
import { Toggle, cx, IconClose, IconPlus } from '..';

// "Emails Orb sends" — the toggles (to visitors / to your team), the visitor
// preview, recipients, and the actions note. Self-contained UI state.

function ToggleRow({ title, desc, on, onToggle, children }) {
  return (
    <div className="px-7 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="orb-body-strong text-orb-ink">{title}</p>
          <p className="mt-0.5 orb-small text-orb-secondary">{desc}</p>
        </div>
        <Toggle checked={on} onChange={onToggle} ariaLabel={title} />
      </div>
      {children}
    </div>
  );
}

function AddressChip({ label, onRemove }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-lg bg-orb-subtle px-2.5 orb-small-medium text-orb-ink">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="text-orb-tertiary transition-colors hover:text-orb-ink focus:outline-none"><IconClose size={11} /></button>
    </span>
  );
}

export default function EmailsCard({ recipients: initialRecipients = ['frontdesk@sanvifertility.in', 'nikita@sanvifertility.in'] }) {
  const [on, setOn] = useState({ confirmation: true, newLead: true, askedPerson: true });
  const [recipients, setRecipients] = useState(initialRecipients);
  const toggle = (k) => setOn((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div className="rounded-2xl border border-orb-hairline bg-orb-white">
      <div className="border-b border-orb-hairline px-7 py-6">
        <p className="orb-card-title text-orb-ink">Emails Orb sends</p>
        <p className="mt-0.5 orb-small text-orb-secondary">Switch each one on or off.</p>
      </div>

      <p className="px-7 pt-4 orb-small-medium text-orb-secondary">To visitors</p>
      <ToggleRow
        title="Confirmation with a recap"
        desc="Sent when a visitor leaves their email. It quotes only Orb’s answers from your knowledge, never what the visitor typed. One per address per day."
        on={on.confirmation}
        onToggle={() => toggle('confirmation')}
      >
        <div className="mt-3 rounded-xl bg-orb-subtle px-4 py-3">
          <p className="orb-small text-orb-secondary">From Sanvi Fertility &amp; IVF · Subject: Your chat with Sanvi Fertility &amp; IVF</p>
          <p className="mt-2 orb-body text-orb-ink">Hi {'{name}'}, thanks for chatting with us. Here’s what we told you:</p>
          <p className="mt-2 orb-body text-orb-secondary">{'{Orb’s answers from your knowledge, word for word}'}</p>
          <p className="mt-2 orb-body text-orb-ink">Questions? Reply to this email and the Sanvi team will get back to you.</p>
        </div>
      </ToggleRow>

      <p className="border-t border-orb-hairline px-7 pt-4 orb-small-medium text-orb-secondary">To your team</p>
      <div className="divide-y divide-orb-hairline">
        <ToggleRow title="New lead" desc="Name, contact, what they asked for and the AI summary." on={on.newLead} onToggle={() => toggle('newLead')} />
        <ToggleRow title="Visitor asked for a person" desc="The chat and the visitor’s details, as soon as they ask." on={on.askedPerson} onToggle={() => toggle('askedPerson')} />
      </div>

      <div className="border-t border-orb-hairline px-7 py-4">
        <p className="orb-small-medium text-orb-secondary">Team emails go to</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {recipients.map((a) => <AddressChip key={a} label={a} onRemove={() => setRecipients((xs) => xs.filter((x) => x !== a))} />)}
          <button type="button" className="inline-flex h-6 items-center gap-1 rounded-lg border border-dashed border-orb-stroke px-2.5 orb-small-medium text-orb-secondary transition-colors hover:border-orb-ink hover:text-orb-ink focus:outline-none">
            <IconPlus size={12} /> Add an address
          </button>
        </div>
      </div>

      <div className="border-t border-orb-hairline px-7 py-3.5">
        <p className="orb-small text-orb-secondary">Emails sent by actions, like the price guide, use the same sender. Change them in Actions.</p>
      </div>
    </div>
  );
}
