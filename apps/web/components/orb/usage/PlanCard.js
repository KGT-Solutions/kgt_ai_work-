import { Card, Button } from '..';

// "Plan" — usage-this-month meter. props: usedPct, usedLabel, note, onManage
export default function PlanCard({ usedPct = 0, usedLabel, note = 'used this month', onManage }) {
  return (
    <Card title="Plan" headerRight={<Button onClick={onManage}>Plan &amp; billing</Button>}>
      <div className="flex items-end gap-2">
        <span className="orb-figure-sm text-orb-ink">{usedLabel}</span>
        <span className="orb-small text-orb-secondary">{note}</span>
      </div>
      <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-orb-base">
        <div className="h-full rounded-full bg-orb-ink" style={{ width: `${Math.max(0, Math.min(100, usedPct))}%` }} />
      </div>
    </Card>
  );
}
