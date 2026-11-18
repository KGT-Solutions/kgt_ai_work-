import { Card, CardExpandButton, Pill, GapChip } from '..';
import { OrbGauge } from '../charts';

// "Knowledge readiness" — gauge + status + the gaps keeping the score down.
// props: score, max, marker, status {label, tone}, checkedAt, gapsNote, gaps [string], onExpand, onFillGap
export default function KnowledgeReadinessCard({
  score, max = 100, marker, status, checkedAt, gapsNote, gaps = [], onExpand, onFillGap
}) {
  return (
    <Card title="Knowledge readiness" headerRight={<CardExpandButton onClick={onExpand} label="Expand Knowledge readiness" />}>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <div className="shrink-0">
          <OrbGauge value={score} max={max} markerLabel={marker} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            {status && <Pill tone={status.tone || 'neutral'}>{status.label}</Pill>}
            <span className="orb-small text-orb-secondary">{checkedAt}</span>
          </div>
          <p className="mt-6 orb-body-strong text-orb-ink">{gapsNote}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {gaps.map((g) => <GapChip key={g} onClick={() => onFillGap?.(g)}>{g}</GapChip>)}
          </div>
        </div>
      </div>
    </Card>
  );
}
