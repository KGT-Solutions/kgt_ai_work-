import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ORB, axisTick, OrbTooltip } from './orbChartTheme';

// Reusable Orb line chart. Multi-series; a series can be `dashed` (e.g. the
// "last week" comparison). Interactive: hover/tap shows a tooltip with each
// series' value for that point, plus a dashed crosshair.
//
// props:
//   data:   [{ [xKey]: label, [series.key]: number, ... }]
//   series: [{ key, label, color?, dashed? }]
//   xKey:   key for the category axis (default 'x')
export default function OrbLineChart({
  data, series, xKey = 'x', height = 240, valueFormatter, hideY = false
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: hideY ? 0 : -12 }}>
        <CartesianGrid vertical={false} stroke={ORB.hairline} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: ORB.hairline }} tick={axisTick} dy={6} />
        {!hideY && <YAxis tickLine={false} axisLine={false} tick={axisTick} width={34} />}
        <Tooltip
          cursor={{ stroke: ORB.stroke, strokeDasharray: '3 3' }}
          content={<OrbTooltip valueFormatter={valueFormatter} />}
        />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color || ORB.ink}
            strokeWidth={2}
            strokeDasharray={s.dashed ? '5 4' : undefined}
            dot={false}
            activeDot={{ r: 4, fill: s.color || ORB.ink, stroke: ORB.white, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
