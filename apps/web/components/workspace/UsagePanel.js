import { useEffect, useState } from 'react';
import { SERIES } from '../../lib/chartColors';
import TimeSeriesChart from '../charts/TimeSeriesChart';
import { Card, CardHeader, Segmented, Skeleton, cx } from '../ui';
import { useToast } from '../ui/toast';
import { IconBolt, IconShield } from '../ui/icons';

// Usage over time, from /usage/daily, and per-bot totals from /usage.
// Support and Sales are shown side by side everywhere (cyan / violet, the
// same colors as the Test bots panes). Charts never share two y-axes:
// answers and tokens are separate charts.
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
  const periodAnswers = daily && sum('aiAnswers') + sum('cacheHits');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-2">All-time: {totals ? `${fmt(totals.questions)} questions, ${fmt(totals.calls)} AI answers, ${fmt(totals.promptTokens + totals.completionTokens)} tokens, ${usd(totals.estimatedCostUsd)}` : '…'}</p>
        <Segmented label="Period" value={days} onChange={setDays}
          options={[{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }]} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Questions" value={daily && sum('questions')} sub={daily && `${fmt(sum('conversations'))} conversations`} />
        <Stat label="AI answers" value={daily && sum('aiAnswers')} sub={daily && `${fmt(sum('supportAnswers'))} support · ${fmt(sum('salesAnswers'))} sales`} />
        <Stat label="Served from cache" value={daily && (periodAnswers ? pct(sum('cacheHits') / periodAnswers) : '—')}
          sub={daily && `${fmt(sum('cacheHits'))} instant answers, no model call`} />
        <Stat label="Est. model cost" value={daily && usd(sum('supportCostUsd') + sum('salesCostUsd'))} sub={daily && `${fmt(sum('tickets'))} tickets filed`} />
      </div>

      <BotBreakdown usage={totals} />

      <Card>
        <CardHeader title="AI answers by bot" description={`Answers that needed a model call, per day, last ${days} days (UTC). Cached answers aren't included.`} />
        <div className="p-5">
          {daily ? (
            <TimeSeriesChart title="AI answers per day by bot" data={daily}
              series={[{ key: 'supportAnswers', label: 'Support Bot', color: SERIES.cyan }, { key: 'salesAnswers', label: 'Sales Bot', color: SERIES.violet }]} />
          ) : <Skeleton className="h-[240px]" />}
        </div>
      </Card>

      <Card>
        <CardHeader title="Tokens by bot" description="Prompt + reply tokens sent to the language model per day." />
        <div className="p-5">
          {daily ? (
            <TimeSeriesChart title="Tokens per day by bot" data={daily} height={180}
              series={[{ key: 'supportTokens', label: 'Support Bot', color: SERIES.cyan }, { key: 'salesTokens', label: 'Sales Bot', color: SERIES.violet }]} />
          ) : <Skeleton className="h-[200px]" />}
        </div>
      </Card>
    </div>
  );
}

const BOT_ROWS = [
  { key: 'support', name: 'Support Bot', icon: IconShield, tone: 'text-cyan-300' },
  { key: 'sales', name: 'Sales Bot', icon: IconBolt, tone: 'text-violet-300' }
];

// All-time per-bot ledger plus what the answer cache saved.
function BotBreakdown({ usage }) {
  if (!usage) return <Skeleton className="h-48" />;
  const other = usage.byBot.other;
  const rows = [...BOT_ROWS, ...(other.aiAnswers || other.questions ? [{ key: 'other', name: 'Other', note: 'Suggested-question generation, and usage from before per-bot tracking' }] : [])];

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-2">
        <CardHeader title="Usage by bot" description="All-time. Cost is an estimate from list prices, not an invoice." />
        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-fg-3">
              <tr>
                <th className="pb-2 font-medium">Bot</th>
                <th className="pb-2 text-right font-medium">Questions</th>
                <th className="pb-2 text-right font-medium">AI answers</th>
                <th className="pb-2 text-right font-medium">Cached</th>
                <th className="pb-2 text-right font-medium">Prompt tokens</th>
                <th className="pb-2 text-right font-medium">Reply tokens</th>
                <th className="pb-2 text-right font-medium">Tokens / day</th>
                <th className="pb-2 text-right font-medium">Est. cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] tabular-nums">
              {rows.map((r) => {
                const b = usage.byBot[r.key];
                const Icon = r.icon;
                return (
                  <tr key={r.key}>
                    <td className="py-2.5">
                      <span className="inline-flex items-center gap-2 font-medium text-fg">
                        {Icon && <Icon className={cx('h-4 w-4', r.tone)} />}{r.name}
                      </span>
                      {r.note && <p className="text-[11px] text-fg-3">{r.note}</p>}
                    </td>
                    <td className="py-2.5 text-right text-fg-2">{fmt(b.questions)}</td>
                    <td className="py-2.5 text-right text-fg-2">{fmt(b.aiAnswers)}</td>
                    <td className="py-2.5 text-right text-fg-2">{fmt(b.cacheHits)}{b.cacheHits ? <span className="text-fg-3"> · {pct(b.cacheHitRate)}</span> : null}</td>
                    <td className="py-2.5 text-right text-fg-2">{fmt(b.promptTokens)}</td>
                    <td className="py-2.5 text-right text-fg-2">{fmt(b.completionTokens)}</td>
                    <td className="py-2.5 text-right text-fg-2" title="Average over the last 7 days">{fmt(b.tokensPerDay)}</td>
                    <td className="py-2.5 text-right text-fg">{usd(b.costUsd)}</td>
                  </tr>
                );
              })}
              <tr className="font-medium">
                <td className="pt-2.5 text-fg">Total</td>
                <td className="pt-2.5 text-right text-fg">{fmt(usage.questions)}</td>
                <td className="pt-2.5 text-right text-fg">{fmt(usage.calls)}</td>
                <td className="pt-2.5 text-right text-fg">{fmt(usage.cacheHits)}</td>
                <td className="pt-2.5 text-right text-fg">{fmt(usage.promptTokens)}</td>
                <td className="pt-2.5 text-right text-fg">{fmt(usage.completionTokens)}</td>
                <td className="pt-2.5 text-right text-fg">{fmt(rows.reduce((a, r) => a + usage.byBot[r.key].tokensPerDay, 0))}</td>
                <td className="pt-2.5 text-right text-fg">{usd(usage.estimatedCostUsd)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Answer cache" description="Repeat questions are answered instantly from memory, with no model call and no cost." />
        <div className="space-y-4 px-5 pb-5">
          <div>
            <p className="text-3xl font-semibold tabular-nums tracking-tight text-fg">{pct(usage.cacheHitRate)}</p>
            <p className="text-xs text-fg-3">of AI answers served instantly from cache</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {BOT_ROWS.map((r) => (
              <div key={r.key}>
                <dt className="text-xs text-fg-3">{r.name}</dt>
                <dd className="tabular-nums text-fg-2">{pct(usage.byBot[r.key].cacheHitRate)} · {fmt(usage.byBot[r.key].cacheHits)} hits</dd>
              </div>
            ))}
            <div>
              <dt className="text-xs text-fg-3">Tokens saved</dt>
              <dd className="tabular-nums text-fg-2">{fmt(usage.savedTokens)}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-3">Cost saved</dt>
              <dd className="tabular-nums text-emerald-300">{usd(usage.savedCostUsd)}</dd>
            </div>
          </dl>
        </div>
      </Card>
    </div>
  );
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
export const pct = (r) => `${(Number(r || 0) * 100).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`;
// Small per-call costs need more than two decimals to be visible at all.
export const usd = (n) => {
  const v = Number(n || 0);
  return `$${v === 0 ? '0.00' : v < 1 ? v.toFixed(4) : v.toFixed(2)}`;
};

// value: a number (formatted with thousands separators) or a preformatted string.
export function Stat({ label, value, sub }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-fg-3">{label}</p>
      {value === null || value === undefined ? <Skeleton className="mt-2 h-7 w-16" /> : (
        <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight text-fg">{typeof value === 'string' ? value : fmt(value)}</p>
      )}
      {sub && <p className="mt-1 text-xs text-fg-3">{sub}</p>}
    </Card>
  );
}
