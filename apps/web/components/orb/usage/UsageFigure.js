import { Card } from '..';

// A Usage figure card: label + big value + a tertiary caption line.
// props: title, value, caption
export default function UsageFigure({ title, value, caption }) {
  return (
    <Card>
      <p className="orb-card-title text-orb-ink">{title}</p>
      <p className="mt-3 orb-display text-orb-ink">{value}</p>
      <p className="mt-3 orb-small text-orb-tertiary">{caption}</p>
    </Card>
  );
}
