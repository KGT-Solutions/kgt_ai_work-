import Pill from './Pill';
import { cx } from './util';

// A ranked list with a horizontal bar per row (e.g. "What visitors ask").
// Simple CSS bars — not a chart. §2: bars use chip-stroke on a hairline track.
//
// props: items [{ label, pct, value?, pill? }], barTrack (px)
export default function RankedBarList({ items, barTrack = 112, className = '' }) {
  return (
    <div className={cx('flex flex-col', className)}>
      {items.map((it, i) => (
        <div key={i} className="flex h-8 items-center gap-3">
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate orb-body text-orb-ink">{it.label}</span>
            {it.pill && <Pill tone={it.pill.tone || 'tint'}>{it.pill.label}</Pill>}
          </span>
          <span className="h-1.5 shrink-0 overflow-hidden rounded-full bg-orb-hairline" style={{ width: barTrack }}>
            <span className="block h-full rounded-full bg-orb-stroke" style={{ width: `${Math.max(0, Math.min(100, it.pct))}%` }} />
          </span>
          <span className="w-9 shrink-0 text-right orb-small-medium text-orb-secondary">{it.value ?? `${it.pct}%`}</span>
        </div>
      ))}
    </div>
  );
}
