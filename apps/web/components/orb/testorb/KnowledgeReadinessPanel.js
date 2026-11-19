import { Card, Pill, ScoreBar, Button, IconRefresh } from '..';

// Test Orb readiness panel: score + score bar + what to add to reach Ready.
// props: score, max, status {label,tone}, marker {at,label}, note, checkedAt,
//        toAddTitle, toAdd [string], onAdd
export default function KnowledgeReadinessPanel({
  score, max = 100, status, marker, note, checkedAt, toAddTitle, toAdd = [], onAdd
}) {
  return (
    <Card title="Knowledge readiness" subtitle="How much of what visitors ask Orb can answer">
      <div className="flex items-end gap-3">
        <span className="flex items-baseline gap-1">
          <span className="orb-figure text-orb-ink">{score}</span>
          <span className="orb-small text-orb-tertiary">/{max}</span>
        </span>
        {status && <Pill tone={status.tone || 'neutral'} className="mb-1.5">{status.label}</Pill>}
      </div>

      <ScoreBar value={score} max={max} marker={marker} />

      <p className="mt-4 orb-small text-orb-secondary">{note}</p>
      <p className="mt-3 flex items-center gap-1.5 orb-small text-orb-tertiary"><IconRefresh size={13} />{checkedAt}</p>

      <div className="mt-4 border-t border-orb-hairline pt-4">
        <p className="orb-small-medium text-orb-secondary">{toAddTitle}</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {toAdd.map((t) => (
            <li key={t} className="flex items-start gap-2 orb-body text-orb-ink">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-orb-ink" />{t}
            </li>
          ))}
        </ul>
        <div className="mt-4"><Button onClick={onAdd}>Add knowledge</Button></div>
      </div>
    </Card>
  );
}
