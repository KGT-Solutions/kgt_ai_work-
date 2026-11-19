import { Pill, Button, cx } from '..';

// Left pane: the conversation list. props: header, items [{ id, name, time, text,
// meta, pills:[{label,tone}] }], selectedId, onSelect, footerNote, onLoadMore
export default function ConversationList({ header, items = [], selectedId, onSelect, footerNote, onLoadMore, className = '' }) {
  return (
    <div className={cx('flex flex-col', className)}>
      <div className="border-b border-orb-hairline px-5 py-3.5">
        <p className="orb-small text-orb-secondary">{header}</p>
      </div>
      <ul className="orb-scrollbar flex-1 divide-y divide-orb-hairline overflow-y-auto">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => onSelect?.(it.id)}
              className={cx('w-full px-5 py-4 text-left transition-colors', selectedId === it.id ? 'bg-orb-subtle' : 'hover:bg-orb-subtle/60')}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate orb-body-strong text-orb-ink">{it.name}</span>
                <span className="shrink-0 orb-small text-orb-tertiary">{it.time}</span>
              </div>
              <p className="mt-1 orb-body text-orb-ink">{it.text}</p>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="truncate orb-small text-orb-secondary">{it.meta}</span>
                {it.pills?.length > 0 && (
                  <span className="flex shrink-0 gap-1.5">{it.pills.map((p, i) => <Pill key={i} tone={p.tone}>{p.label}</Pill>)}</span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 border-t border-orb-hairline px-5 py-3.5">
        <span className="orb-small text-orb-secondary">{footerNote}</span>
        <Button onClick={onLoadMore}>Load more</Button>
      </div>
    </div>
  );
}
