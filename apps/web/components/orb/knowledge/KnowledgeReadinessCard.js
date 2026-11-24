import { Card, CardExpandButton, Pill, Button, Select } from '..';
import { OrbGauge } from '../charts';

// Which bot the readiness is shown for. Support and Sales train on their own
// material, so each has its own score and gaps (API: report.bots.{support,sales}).
const DEFAULT_BOTS = [
  { value: 'support', label: 'Support bot' },
  { value: 'sales', label: 'Sales bot' }
];

// Knowledge-page readiness card: the gauge + the gaps as full rows (title +
// description + a fix action), richer than the Overview chip version.
// props: score, max, marker, status {label,tone}, checkedAt, gapsNote,
//        gaps [{ title, desc, actionLabel }], onExpand, onFix
//        bot/onBot/bots — the small bot switcher shown top-right.
export default function KnowledgeReadinessCard({
  score, max = 100, marker, status, checkedAt, gapsNote, gaps = [],
  bot, onBot, bots = DEFAULT_BOTS, onExpand, onFix
}) {
  const headerRight = (
    <>
      {bots.length > 0 && (
        <Select size="sm" value={bot} onChange={(e) => onBot?.(e.target.value)} options={bots} ariaLabel="Choose bot" />
      )}
      <CardExpandButton onClick={onExpand} label="Expand Knowledge readiness" />
    </>
  );
  return (
    <Card title="Knowledge readiness" headerRight={headerRight}>
      <div className="flex flex-col gap-6 sm:flex-row">
        <div className="shrink-0 sm:pt-2">
          <OrbGauge value={score} max={max} markerLabel={marker} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            {status && <Pill tone={status.tone || 'tint'}>{status.label}</Pill>}
            <span className="orb-small text-orb-secondary">{checkedAt}</span>
          </div>
          <p className="mt-4 orb-body-strong text-orb-ink">{gapsNote}</p>
          <ul className="mt-1 divide-y divide-orb-hairline">
            {gaps.map((g) => (
              <li key={g.title} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate orb-body-strong text-orb-ink">{g.title}</p>
                  {g.desc && <p className="truncate orb-small text-orb-secondary">{g.desc}</p>}
                </div>
                <Button onClick={() => onFix?.(g)}>{g.actionLabel || 'Add'}</Button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
