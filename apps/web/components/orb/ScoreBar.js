// Linear score bar with a target marker (§9 Score bar). e.g. 64/100, marker at 80.
// props: value, max=100, marker { at, label }
export default function ScoreBar({ value, max = 100, marker }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const mpct = marker ? Math.max(0, Math.min(100, (marker.at / max) * 100)) : null;
  return (
    <div className="relative pt-5">
      {marker && (
        <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap orb-small-medium text-orb-secondary" style={{ left: `${mpct}%` }}>
          {marker.label}
        </span>
      )}
      <div className="relative h-2 overflow-visible rounded-full bg-orb-hairline">
        <div className="h-full rounded-full bg-orb-ink" style={{ width: `${pct}%` }} />
        {marker && <span className="absolute -top-0.5 h-3 w-0.5 -translate-x-1/2 rounded bg-orb-ink" style={{ left: `${mpct}%` }} />}
      </div>
    </div>
  );
}
