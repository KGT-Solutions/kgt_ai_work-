import { Card } from '..';

// "Reused answers" — explains the no-cost reuse window. props: body
export default function ReusedAnswersCard({ body }) {
  return (
    <Card title="Reused answers">
      <p className="orb-small leading-relaxed text-orb-secondary">{body}</p>
    </Card>
  );
}
