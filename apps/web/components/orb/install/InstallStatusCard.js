import { Card, Pill, IconCheck, IconRefresh } from '..';
import { cx } from '../util';

// "Install status" — Live pill + the 3 done steps (copy / paste / first chat).
// props: statusLabel, note, steps [{ title, sub }]
export default function InstallStatusCard({ statusLabel = 'Live', note, steps = [] }) {
  return (
    <Card
      title={<span className="inline-flex items-center gap-2">Install status <Pill tone="tint">{statusLabel}</Pill></span>}
      subtitle={note}
      headerRight={
        <span className="flex items-center gap-1.5 orb-small text-orb-secondary">
          <IconRefresh size={14} /> Updates while this page is open
        </span>
      }
    >
      <div className="grid grid-cols-1 border-t border-orb-hairline pt-5 sm:grid-cols-3 sm:divide-x sm:divide-orb-hairline">
        {steps.map((s, i) => (
          <div key={s.title} className={cx('flex items-center gap-3 py-2 sm:py-0', i > 0 && 'sm:pl-6', i < steps.length - 1 && 'sm:pr-6')}>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-orb-ink text-orb-white"><IconCheck size={14} /></span>
            <div className="min-w-0">
              <p className="orb-body-strong text-orb-ink">{s.title}</p>
              <p className="orb-small text-orb-secondary">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
