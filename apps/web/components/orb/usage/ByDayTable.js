import { cx } from '..';

// "By day" — the seven days in numbers, edge-to-edge table with right-aligned
// numeric columns and a bold Total row. Matches Figma 512:2073.
// props: rows [{ day, conversations, spent, per, saved, total? }], footerNote
function Row({ cells, head, strong }) {
  const textCls = head ? 'orb-small text-orb-tertiary' : strong ? 'orb-body-strong text-orb-ink' : 'orb-body text-orb-ink';
  return (
    <div className={cx('flex items-center gap-4 px-7', head ? 'bg-orb-subtle py-2.5' : 'border-t border-orb-hairline py-3')}>
      <span className={cx('min-w-0 flex-1', textCls)}>{cells[0]}</span>
      {cells.slice(1).map((c, i) => (
        <span key={i} className={cx('w-[150px] shrink-0 text-right', textCls)}>{c}</span>
      ))}
    </div>
  );
}

export default function ByDayTable({ rows = [], footerNote }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-orb-hairline bg-orb-white">
      <div className="px-7 pb-4 pt-6">
        <p className="orb-card-title text-orb-ink">By day</p>
        <p className="mt-0.5 orb-small text-orb-tertiary">The same seven days, in numbers.</p>
      </div>
      <Row head cells={['Day', 'Conversations', 'Spent', 'Per conversation', 'Saved by reuse']} />
      {rows.map((r) => (
        <Row key={r.day} strong={r.total} cells={[r.day, r.conversations, r.spent, r.per, r.saved]} />
      ))}
      {footerNote && (
        <div className="border-t border-orb-hairline px-7 py-3.5">
          <p className="orb-small text-orb-tertiary">{footerNote}</p>
        </div>
      )}
    </div>
  );
}
