import { Card, Pill, Button, IconGrid, IconMail, IconCalendar, IconChat } from '..';

// "Where actions send things" — connected destinations.
// props: integrations [{ id, icon, name, desc, connected }], onConnect
const ICONS = { crm: IconGrid, mail: IconMail, calendar: IconCalendar, chat: IconChat };

export default function IntegrationsCard({ integrations = [], onConnect }) {
  return (
    <Card title="Where actions send things" subtitle="Connect once. Every action can use these.">
      <ul className="-mt-1 divide-y divide-orb-hairline">
        {integrations.map((it) => {
          const Icon = ICONS[it.icon] || IconGrid;
          return (
            <li key={it.id} className="flex items-center gap-3 py-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-orb-subtle text-orb-ink"><Icon size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="orb-body-strong text-orb-ink">{it.name}</p>
                <p className="orb-small text-orb-secondary">{it.desc}</p>
              </div>
              {it.connected ? <Pill tone="tint">Connected</Pill> : <Button onClick={() => onConnect?.(it)}>Connect</Button>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
