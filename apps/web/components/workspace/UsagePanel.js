import { useEffect, useState } from 'react';
import { SERIES } from '../../lib/chartColors';
import TimeSeriesChart from '../charts/TimeSeriesChart';
import { Card, CardHeader, Segmented, Skeleton } from '../ui';
import { useToast } from '../ui/toast';

// Usage over time, from /usage/daily. Two charts, never two y-axes: activity
// (questions and AI answers share a unit) and tokens (a different scale).
export default function UsagePanel({ ws }) {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [daily, setDaily] = useState(null);
  const [totals, setTotals] = useState(null);

  useEffect(() => {
    setDaily(null);
    ws.getDailyUsage(days).then((r) => setDaily(r.series)).catch((e) => toast.error(e.message));
  }, [ws, days]);
  useEffect(() => { ws.getUsage().then(setTotals).catch((e) => toast.error(e.message)); }, [ws]);

  const sum = (k) => (daily || []).reduce((a, d) => a + d[k], 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-2">All-time: {totals ? `${fmt(totals.questions)} questions, ${fmt(totals.calls)} AI answers, ${fmt(totals.promptTokens + totals.completionTokens)} tokens` : '…'}</p>
        <Segmented label="Period" value={days} onChange={setDays}
          options={[{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }]} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Questions" value={daily && sum('questions')} />
        <Stat label="Conversations" value={daily && sum('conversations')} />
        <Stat label="AI answers" value={daily && sum('aiAnswers')} />
        <Stat label="Tickets filed" value={daily && sum('tickets')} />
      </div>

      <Card>
        <CardHeader title="Activity" description={`Questions asked and answers generated per day, last ${days} days (UTC).`} />
        <div className="p-5">
          {daily ? (
            <TimeSeriesChart title="Questions and AI answers per day" data={daily}
              series={[{ key: 'questions', label: 'Questions', color: SERIES.cyan }, { key: 'aiAnswers', label: 'AI answers', color: SERIES.violet }]} />
          ) : <Skeleton className="h-[240px]" />}
        </div>
      </Card>

      <Card>
        <CardHeader title="Tokens" description="Prompt + reply tokens sent to the language model per day." />
        <div className="p-5">
          {daily ? <TimeSeriesChart title="Tokens per day" data={daily} series={[{ key: 'tokens', label: 'Tokens', color: SERIES.cyan }]} height={180} />
            : <Skeleton className="h-[200px]" />}
        </div>
      </Card>
    </div>
  );
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export function Stat({ label, value, sub }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-fg-3">{label}</p>
      {value === null || value === undefined ? <Skeleton className="mt-2 h-7 w-16" /> : (
        <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-fg">{fmt(value)}</p>
      )}
      {sub && <p className="mt-1 text-xs text-fg-3">{sub}</p>}
    </Card>
  );
}
