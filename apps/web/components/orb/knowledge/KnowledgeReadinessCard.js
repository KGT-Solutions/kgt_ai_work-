import { Card, CardExpandButton, Pill, Button } from '..';
import { OrbGauge } from '../charts';

// Knowledge-page readiness card: the gauge + the gaps as full rows (title +
// description + a fix action), richer than the Overview chip version.
// props: score, max, marker, status {label,tone}, checkedAt, gapsNote,
//        gaps [{ title, desc, actionLabel }], onExpand, onFix
export default function KnowledgeReadinessCard({
  score, max = 100, marker, status, checkedAt, gapsNote, gaps = [], onExpand, onFix
}) {
  return (
    <Card title="Knowledge readiness" headerRight={<CardExpandButton onClick={onExpand} label="Expand Knowledge readiness" />}>
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
                  <p className="truncate orb-small text-orb-secondary">{g.desc}</p>
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
