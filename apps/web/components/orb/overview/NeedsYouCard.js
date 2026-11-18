import { Card, Pill, Button } from '..';

// "Needs you" — the queue of things requiring the team, each with a one-tap action.
// props: count, items [{ id, badge, title, sub, actionLabel, onAction }], note { text, onDetails }
export default function NeedsYouCard({ count, items = [], note }) {
  return (
    <Card title="Needs you" headerRight={<Pill tone="yellow">{count}</Pill>}>
      <ul className="-mt-2 divide-y divide-orb-hairline">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-3 py-3">
            <Pill tone="yellow" className="min-w-[40px] justify-center">{it.badge}</Pill>
            <div className="min-w-0 flex-1">
              <p className="truncate orb-body-strong text-orb-ink">{it.title}</p>
              <p className="truncate orb-small text-orb-secondary">{it.sub}</p>
            </div>
            <Button onClick={it.onAction}>{it.actionLabel}</Button>
          </li>
        ))}
      </ul>
      {note && (
        <div className="mt-1 flex items-center gap-2 border-t border-orb-hairline pt-3">
          <svg viewBox="0 0 16 16" width="14" height="14" className="shrink-0 text-orb-secondary" fill="none" stroke="currentColor" strokeWidth="1.33" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" /><path d="M8 5v3.5M8 11h.01" strokeLinecap="round" />
          </svg>
          <span className="min-w-0 flex-1 truncate orb-small text-orb-secondary">{note.text}</span>
          <button type="button" onClick={note.onDetails} className="shrink-0 orb-small-medium text-orb-ink hover:underline focus:outline-none">Details</button>
        </div>
      )}
    </Card>
  );
}
