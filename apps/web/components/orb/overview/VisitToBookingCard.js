import { Card, CardExpandButton, Pill } from '..';

// "From visit to booking" — the conversion funnel. Each step shows its count and
// (except the first) a bar for its share of the step above.
// props: headlinePct, headlineNote, steps [{ label, value, pill?, barPct?, barNote? }], footnote, onExpand
export default function VisitToBookingCard({ headlinePct, headlineNote, steps = [], footnote, onExpand }) {
  return (
    <Card title="From visit to booking" headerRight={<CardExpandButton onClick={onExpand} label="Expand From visit to booking" />}>
      <div className="flex items-baseline gap-2">
        <span className="orb-display text-orb-ink">{headlinePct}</span>
        <span className="orb-small text-orb-secondary">{headlineNote}</span>
      </div>

      <div className="mt-5 flex flex-col gap-5">
        {steps.map((s) => (
          <div key={s.label}>
            <div className="flex items-center justify-between gap-3 border-b border-orb-hairline pb-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate orb-body text-orb-ink">{s.label}</span>
                {s.pill && <Pill tone={s.pill.tone || 'yellow'}>{s.pill.label}</Pill>}
              </span>
              <span className="orb-body-strong text-orb-ink">{s.value}</span>
            </div>
            {s.barPct != null && (
              <div className="mt-2 flex items-center gap-3">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-orb-hairline">
                  <span className="block h-full rounded-full bg-orb-stroke" style={{ width: `${Math.max(0, Math.min(100, s.barPct))}%` }} />
                </span>
                <span className="w-32 shrink-0 text-right orb-small text-orb-secondary">{s.barNote}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {footnote && <p className="mt-5 orb-small text-orb-tertiary">{footnote}</p>}
    </Card>
  );
}
