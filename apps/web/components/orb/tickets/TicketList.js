import { Pill, cx } from '..';

// Generic left-pane list for Tickets (works for both tabs).
// props: header, items [{ id, title, right, text, meta, pill:{label,tone} }],
//        selectedId, onSelect, footerNote
export default function TicketList({ header, items = [], selectedId, onSelect, footerNote, className = '' }) {
  return (
    <div className={cx('flex flex-col', className)}>
      <div className="border-b border-orb-hairline px-5 py-3.5"><p className="orb-small text-orb-secondary">{header}</p></div>
      <ul className="orb-scrollbar flex-1 divide-y divide-orb-hairline overflow-y-auto">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" onClick={() => onSelect?.(it.id)} className={cx('w-full px-5 py-4 text-left transition-colors', selectedId === it.id ? 'bg-orb-subtle' : 'hover:bg-orb-subtle/60')}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate orb-body-strong text-orb-ink">{it.title}</span>
                <span className="shrink-0 orb-small-medium text-orb-secondary">{it.right}</span>
              </div>
              <p className="mt-1 orb-body text-orb-ink">{it.text}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="truncate orb-small text-orb-secondary">{it.meta}</span>
                {it.pill && <Pill tone={it.pill.tone}>{it.pill.label}</Pill>}
              </div>
            </button>
          </li>
        ))}
      </ul>
      {footerNote && <div className="border-t border-orb-hairline px-5 py-3.5"><p className="orb-small text-orb-tertiary">{footerNote}</p></div>}
    </div>
  );
}
