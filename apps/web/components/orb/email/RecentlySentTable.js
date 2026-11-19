import { Pill, Button, cx } from '..';

// "Recently sent" — the latest emails and their result.
// props: rows [{ when, to, email, result:{label,tone}, note? }], footerNote, onSeeAll
const COLS = 'grid grid-cols-[180px_minmax(0,240px)_minmax(0,1fr)_200px] items-center gap-4';

export default function RecentlySentTable({ rows = [], footerNote, onSeeAll }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-orb-hairline bg-orb-white">
      <div className="px-7 pb-4 pt-6">
        <p className="orb-card-title text-orb-ink">Recently sent</p>
        <p className="mt-0.5 orb-small text-orb-secondary">Check that an email went out, and why one didn’t.</p>
      </div>
      <div className={`${COLS} bg-orb-subtle px-7 py-2.5`}>
        {['When', 'To', 'Email', 'Result'].map((h) => <span key={h} className="orb-small text-orb-tertiary">{h}</span>)}
      </div>
      <ul>
        {rows.map((r, i) => (
          <li key={i} className={`${COLS} border-t border-orb-hairline px-7 py-3`}>
            <span className="orb-body text-orb-ink">{r.when}</span>
            <span className="truncate orb-body text-orb-ink">{r.to}</span>
            <span className="truncate orb-body text-orb-ink">{r.email}</span>
            <span className="flex items-center gap-2">
              <Pill tone={r.result.tone}>{r.result.label}</Pill>
              {r.note && <span className="truncate orb-small text-orb-secondary">{r.note}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-orb-hairline px-7 py-3.5">
        <span className="orb-small text-orb-secondary">{footerNote}</span>
        <Button onClick={onSeeAll}>See all</Button>
      </div>
    </div>
  );
}
