import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ORB, axisTick, OrbTooltip } from './orbChartTheme';

// Reusable Orb bar chart / histogram (e.g. conversations by hour). Interactive:
// hover/tap shows a tooltip with the bar's value. `colorFor(d, i)` lets callers
// shade bars by state (e.g. after-hours dark, daytime light).
//
// props:
//   data:    [{ [xKey]: label, [yKey]: number, ... }]
//   xKey:    category key (default 'x')
//   yKey:    value key (default 'value')
//   colorFor: (datum, index) => hex  (default ORB.ink)
export default function OrbBarChart({
  data, xKey = 'x', yKey = 'value', height = 240, colorFor, valueFormatter,
  barRadius = 3, hideY = true, barName
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: hideY ? 0 : -12 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke={ORB.hairline} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={{ stroke: ORB.hairline }} tick={axisTick} dy={6} interval="preserveStartEnd" minTickGap={24} />
        {hideY ? <YAxis hide /> : <YAxis tickLine={false} axisLine={false} tick={axisTick} width={34} />}
        <Tooltip
          cursor={{ fill: 'rgba(32,32,32,0.05)' }}
          content={<OrbTooltip valueFormatter={valueFormatter} />}
        />
        <Bar dataKey={yKey} name={barName} radius={[barRadius, barRadius, 0, 0]} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={colorFor ? colorFor(d, i) : ORB.ink} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
