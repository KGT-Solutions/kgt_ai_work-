import { Pill, Button, Select } from '..';

// Leads & bookings table. props: subtitle, statusValue, statusOptions, onStatus,
// leads [{ id, name, sub, phone, email, askedFor, askedSub, when, whenTime, status:{label,tone} }],
// footerNote, onLoadMore, onOpen
const COLS = 'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_120px_110px] items-center gap-4';

export default function LeadsTable({ subtitle, statusValue, statusOptions = [], onStatus, leads = [], footerNote, onLoadMore, onOpen }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-orb-hairline bg-orb-white">
      <div className="flex items-center justify-between gap-3 px-6 py-4">
        <p className="orb-small text-orb-secondary">{subtitle}</p>
        <Select ariaLabel="Status filter" value={statusValue} options={statusOptions} onChange={onStatus} />
      </div>
      <div className={`${COLS} bg-orb-subtle px-6 py-2.5`}>
        {['Name', 'Contact', 'Asked for', 'When', 'Status'].map((h) => <span key={h} className="orb-heading text-orb-secondary">{h}</span>)}
      </div>
      <ul className="divide-y divide-orb-hairline">
        {leads.map((l) => (
          <li key={l.id}>
            <button type="button" onClick={() => onOpen?.(l)} className={`${COLS} w-full px-6 py-3.5 text-left transition-colors hover:bg-orb-subtle/50`}>
              <div className="min-w-0">
                <p className="truncate orb-body-strong text-orb-ink">{l.name}</p>
                <p className="truncate orb-small text-orb-secondary">{l.sub}</p>
              </div>
              <div className="min-w-0">
                <p className="truncate orb-body text-orb-ink">{l.phone}</p>
                <p className="truncate orb-small text-orb-secondary">{l.email}</p>
              </div>
              <div className="min-w-0">
                <p className="truncate orb-body text-orb-ink">{l.askedFor}</p>
                <p className="truncate orb-small text-orb-secondary">{l.askedSub}</p>
              </div>
              <div className="min-w-0">
                <p className="orb-body text-orb-ink">{l.when}</p>
                <p className="orb-small text-orb-tertiary">{l.whenTime}</p>
              </div>
              <div><Pill tone={l.status.tone}>{l.status.label}</Pill></div>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 px-6 py-4">
        <span className="orb-small text-orb-secondary">{footerNote}</span>
        <Button onClick={onLoadMore}>Load more</Button>
      </div>
    </div>
  );
}
