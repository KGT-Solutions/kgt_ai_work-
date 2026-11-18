import { Card, Pill } from '..';
import { OrbLineChart, ORB } from '../charts';

// "Patient enquiries" — headline figure + this-week-vs-last line chart + a
// highlighted-day summary + the booking funnel tail stats.
// props: value, delta {label,tone}, chartData, chartSeries, daySummary [string],
//        stats [{ label, value, pill? }]
function LegendSwatch({ dashed }) {
  return (
    <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
      <line x1="0" y1="4" x2="22" y2="4" stroke={dashed ? ORB.stroke : ORB.ink} strokeWidth="2" strokeDasharray={dashed ? '4 3' : undefined} />
    </svg>
  );
}

export default function PatientEnquiriesCard({ value, delta, chartData, chartSeries, daySummary = [], stats = [] }) {
  return (
    <Card
      title="Patient enquiries"
      headerRight={
        <div className="flex items-center gap-4">
          {chartSeries.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 orb-small text-orb-secondary">
              <LegendSwatch dashed={s.dashed} />{s.label}
            </span>
          ))}
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="orb-display text-orb-ink">{value}</span>
          {delta && <Pill tone={delta.tone || 'neutral'}>{delta.label}</Pill>}
        </div>
        {daySummary.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-orb-hairline px-3 py-1.5">
            {daySummary.map((part, i) => (
              <span key={i} className="orb-small text-orb-secondary">
                {i === 0 ? <span className="orb-small-strong text-orb-ink">{part}</span> : part}
                {i < daySummary.length - 1 && <span className="ml-2 text-orb-tertiary">·</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <OrbLineChart data={chartData} series={chartSeries} xKey="x" height={240} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4 border-t border-orb-hairline pt-4">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="orb-small text-orb-secondary">{s.label}</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="orb-figure-sm text-orb-ink">{s.value}</span>
              {s.pill && <Pill tone={s.pill.tone || 'tint'}>{s.pill.label}</Pill>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
