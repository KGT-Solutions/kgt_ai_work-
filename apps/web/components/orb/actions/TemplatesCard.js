import { Card, Pill, Button, IconCheck, IconCalendar, IconFile, IconPhone, IconLink } from '..';

// "Templates for fertility clinics" — a grid of starter actions.
// props: templates [{ id, icon, title, status:'added'|'draft'|'add' }], onAdd
const ICONS = { calendar: IconCalendar, file: IconFile, phone: IconPhone, link: IconLink };

function Status({ status, onAdd }) {
  if (status === 'added') return <span className="flex items-center gap-1 orb-small text-orb-secondary"><IconCheck size={13} />Added</span>;
  if (status === 'draft') return <Pill tone="neutral">Draft</Pill>;
  return <Button size="sm" onClick={onAdd}>Add</Button>;
}

export default function TemplatesCard({ templates = [], onAdd }) {
  return (
    <Card title="Templates for fertility clinics" subtitle="Pick one and change what you need. Setup is a choice, not a build.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {templates.map((t) => {
          const Icon = ICONS[t.icon] || IconCalendar;
          return (
            <div key={t.id} className="flex flex-col justify-between rounded-xl border border-orb-hairline p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-orb-ink"><Icon size={18} /></span>
                <Status status={t.status} onAdd={() => onAdd?.(t)} />
              </div>
              <p className="mt-6 orb-body-strong text-orb-ink">{t.title}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
