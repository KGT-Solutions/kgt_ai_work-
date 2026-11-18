import Card, { CardExpandButton } from './Card';
import Pill from './Pill';

// Small figure card (e.g. "Answered by Orb 87%", "Cost per enquiry ₹65").
// §3.2 Console/Figure for the number; an optional delta Pill below.
//
// props: title, value, delta ({ tone, label }), onExpand, expandable
export default function StatCard({ title, value, delta, onExpand, expandable = true, className = '' }) {
  return (
    <Card
      title={title}
      headerRight={expandable ? <CardExpandButton onClick={onExpand} label={`Expand ${title}`} /> : null}
      className={className}
    >
      <p className="orb-figure text-orb-ink">{value}</p>
      {delta && <div className="mt-3"><Pill tone={delta.tone || 'neutral'}>{delta.label}</Pill></div>}
    </Card>
  );
}
