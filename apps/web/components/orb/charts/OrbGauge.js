import { ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis } from 'recharts';
import { ORB } from './orbChartTheme';

// Reusable Orb readiness gauge — a radial ring (e.g. Knowledge readiness 86/100)
// with the big figure in the centre. Interactive hover is handled by callers via
// the surrounding card; the ring itself is a focused single-value display.
//
// props:
//   value / max   the figure (e.g. 86 / 100)
//   centerSuffix  small text under the figure (default `/${max}`)
//   markerLabel   optional label rendered under the ring (e.g. "Ready 80")
export default function OrbGauge({
  value, max = 100, size = 180, arcColor = ORB.ink, trackColor = ORB.hairline,
  centerSuffix, markerLabel
}) {
  const data = [{ name: 'value', value }];
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <div className="relative" style={{ width: size, height: size * 0.82 }}>
        <ResponsiveContainer width="100%" height="100%">
          {/* ~260° arc with a gap at the bottom (startAngle 230 → endAngle -50). */}
          <RadialBarChart
            innerRadius="76%"
            outerRadius="100%"
            data={data}
            startAngle={230}
            endAngle={-50}
          >
            <PolarAngleAxis type="number" domain={[0, max]} angleAxisId={0} tick={false} />
            <RadialBar
              background={{ fill: trackColor }}
              dataKey="value"
              cornerRadius={99}
              fill={arcColor}
              angleAxisId={0}
              isAnimationActive={false}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="orb-display leading-none text-orb-ink">{value}</span>
          <span className="mt-0.5 orb-small text-orb-tertiary">{centerSuffix ?? `/${max}`}</span>
        </div>
      </div>
      {markerLabel && <span className="-mt-2 orb-small-medium text-orb-secondary">{markerLabel}</span>}
    </div>
  );
}
