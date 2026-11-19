import { Pill, Button, ChatMessage, IconSpark, IconLock } from '..';

// Right pane for the "Asked for a person" tab: contact details, AI summary, the
// last messages, and actions.
function ReachRow({ label, value }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-center gap-4 border-b border-orb-hairline py-3 last:border-b-0">
      <span className="orb-small text-orb-secondary">{label}</span>
      <span className="orb-body text-orb-ink">{value}</span>
    </div>
  );
}

export default function PersonDetail({ person, className = '' }) {
  if (!person) return null;
  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-start gap-3 border-b border-orb-hairline px-6 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="orb-card-title text-orb-ink">{person.name}</span>
            {person.waiting && <Pill tone="yellow">{person.waiting}</Pill>}
          </div>
          <p className="mt-1 orb-small text-orb-secondary">{person.meta}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button>Open conversation</Button>
          <Button variant="primary">Mark as contacted</Button>
        </div>
      </div>

      <div className="orb-scrollbar flex-1 overflow-y-auto px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <p className="orb-body-strong text-orb-ink">How to reach them</p>
          <Button>Open in Leads &amp; bookings</Button>
        </div>
        <div className="mt-2">
          <ReachRow label="Phone" value={person.reach?.phone} />
          <ReachRow label="Email" value={person.reach?.email} />
          <ReachRow label="Prefers" value={person.reach?.prefers} />
        </div>

        {person.summary && (
          <div className="mt-5 rounded-xl bg-orb-subtle px-4 py-3">
            <p className="flex items-center gap-1.5 orb-small-strong text-orb-ink"><IconSpark size={14} /> AI summary <span className="orb-small text-orb-secondary">· {person.summaryMeta}</span></p>
            <p className="mt-1.5 orb-small text-orb-secondary">{person.summary}</p>
          </div>
        )}

        <p className="mt-6 mb-3 orb-body-strong text-orb-ink">Last messages</p>
        <div className="flex flex-col gap-5">
          {person.messages?.map((m, i) => <ChatMessage key={i} m={m} />)}
        </div>
      </div>

      {person.footer && (
        <div className="flex items-center gap-2 border-t border-orb-hairline px-6 py-3.5">
          <span className="text-orb-tertiary"><IconLock size={14} /></span>
          <span className="orb-small text-orb-secondary">{person.footer}</span>
        </div>
      )}
    </div>
  );
}
