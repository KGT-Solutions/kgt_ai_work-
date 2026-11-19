import { Card, Pill, Toggle, IconCalendar, IconFile, IconPhone, IconMail, IconUser, IconLink, IconMore } from '..';

// "Your actions" — the configured actions with triggers, effect, stat and on/off.
// props: subtitle, actions [{ id, icon, title, badge:{label,tone}, triggers, happens, stat, on }], footerNote, onToggle
const ICONS = { calendar: IconCalendar, file: IconFile, phone: IconPhone, mail: IconMail, user: IconUser, link: IconLink };
const COLS = 'grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_104px_48px_36px] items-center gap-4';

export default function ActionsTable({ subtitle, actions = [], footerNote, onToggle, onEdit }) {
  return (
    <Card title="Your actions" subtitle={subtitle}>
      <div className="overflow-hidden rounded-xl border border-orb-hairline">
        <div className={`${COLS} bg-orb-subtle px-4 py-2.5`}>
          {['Action · offered when a visitor asks…', 'What happens', 'Last 7 days', 'On', ''].map((h, i) => (
            <span key={i} className="orb-heading text-orb-secondary">{h}</span>
          ))}
        </div>
        <ul className="divide-y divide-orb-hairline">
          {actions.map((a) => {
            const Icon = ICONS[a.icon] || IconCalendar;
            return (
              <li key={a.id} className={`${COLS} px-4 py-3.5`}>
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orb-subtle text-orb-ink"><Icon size={16} /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="orb-body-strong text-orb-ink">{a.title}</p>
                      {a.badge && <Pill tone={a.badge.tone || 'tint'}>{a.badge.label}</Pill>}
                    </div>
                    <p className="orb-small text-orb-secondary">{a.triggers}</p>
                  </div>
                </div>
                <p className="orb-small text-orb-secondary">{a.happens}</p>
                <span className="orb-body text-orb-secondary">{a.stat}</span>
                <Toggle checked={a.on} onChange={(v) => onToggle?.(a, v)} ariaLabel={`Turn ${a.title} ${a.on ? 'off' : 'on'}`} />
                <button type="button" aria-label={`Edit ${a.title}`} onClick={() => onEdit?.(a)} className="flex size-7 items-center justify-center rounded-lg text-orb-secondary transition-colors hover:bg-orb-subtle hover:text-orb-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink"><IconMore size={16} /></button>
              </li>
            );
          })}
        </ul>
      </div>
      {footerNote && <p className="mt-4 orb-small text-orb-secondary">{footerNote}</p>}
    </Card>
  );
}
