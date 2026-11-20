import { Button, Pill, cx } from '..';
import { OrbFormCard } from '../auth';

// Step 5 (Figma 0F): review summary + what's next, then create.
const ROWS = [
  ['Company', 'Sanvi Fertility & IVF'],
  ['Your name', 'Nikita Deshpande'],
  ['Industry', 'Fertility & IVF clinic'],
  ['Sign-in email', 'nikita@sanvifertility.in'],
  ['Bots switched on', 'Sales and Support'],
  ['Knowledge', '12 entries · 13,910 characters · Overview 10, FAQ 1, Policies & pricing 1'],
  ['Scores', 'Sales 71 · Support 64 · Orb readiness 64, Moderate']
];
const NEXT = [
  { t: 'Test Orb', d: 'Ask a few real patient questions. Test chats don’t count in your results.' },
  { t: 'Install', d: 'Paste one snippet on sanvifertility.in. Orb shows Live after the first visitor chat.' }
];

export default function ReviewStep({ onBack, onCreate }) {
  return (
    <OrbFormCard
      width={880}
      title="Review and create"
      subtitle="Check the details, then create your workspace. Orb isn’t on your site until you install it."
      footer={(
        <div className="flex items-center justify-between">
          <Button onClick={onBack}>Back</Button>
          <Button variant="primary" size="md" onClick={onCreate}>Create workspace &amp; test Orb</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="overflow-hidden rounded-xl border border-orb-hairline">
          {ROWS.map(([label, value], i) => (
            <div key={label} className={cx('grid grid-cols-[180px_1fr] gap-4 px-4 py-3', i > 0 && 'border-t border-orb-hairline')}>
              <span className="orb-small text-orb-secondary">{label}</span>
              <span className="orb-body text-orb-ink">{value}</span>
            </div>
          ))}
        </div>

        <div className="flex items-start gap-3 rounded-[10px] bg-orb-subtle px-3.5 py-3">
          <Pill tone="yellow">Below Ready</Pill>
          <div>
            <p className="orb-small-strong text-orb-ink">Both bots are under Ready (80)</p>
            <p className="mt-0.5 orb-small text-orb-secondary">Questions Orb can’t answer will become tickets for your team. Add knowledge now with Back, or any time later from Knowledge.</p>
          </div>
        </div>

        <div>
          <p className="mb-2 orb-small-medium text-orb-secondary">What’s next</p>
          <ol className="flex flex-col gap-3">
            {NEXT.map((n, i) => (
              <li key={n.t} className="flex gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-orb-stroke orb-micro text-orb-ink">{i + 1}</span>
                <div>
                  <p className="orb-body-strong text-orb-ink">{n.t}</p>
                  <p className="orb-small text-orb-secondary">{n.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </OrbFormCard>
  );
}
