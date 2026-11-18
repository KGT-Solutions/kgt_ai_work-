import { Card, CardExpandButton } from '..';
import { OrbBarChart, ORB } from '../charts';

// "When visitors talk to Orb" — headline + conversations-by-hour histogram +
// busiest/quietest. barData items carry `highlight` (after-hours) for shading.
// props: pct, note, barData [{ x, value, highlight }], busiest, quietest, onExpand
export default function WhenVisitorsTalkCard({ pct, note, barData = [], busiest, quietest, onExpand }) {
  return (
    <Card title="When visitors talk to Orb" headerRight={<CardExpandButton onClick={onExpand} label="Expand When visitors talk to Orb" />}>
      <div className="flex items-baseline gap-2">
        <span className="orb-display text-orb-ink">{pct}</span>
        <span className="orb-small text-orb-secondary">{note}</span>
      </div>

      <div className="mt-4">
        <OrbBarChart
          data={barData}
          xKey="x"
          yKey="value"
          barName="conversations"
          height={200}
          colorFor={(d) => (d.highlight ? ORB.ink : ORB.lightGrey)}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 border-t border-orb-hairline pt-4">
        <div>
          <p className="orb-small text-orb-secondary">Busiest</p>
          <p className="mt-1 orb-figure-sm text-orb-ink">{busiest}</p>
        </div>
        <div>
          <p className="orb-small text-orb-secondary">Quietest</p>
          <p className="mt-1 orb-figure-sm text-orb-ink">{quietest}</p>
        </div>
      </div>
    </Card>
  );
}
