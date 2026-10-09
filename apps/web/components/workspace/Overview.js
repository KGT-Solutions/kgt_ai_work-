import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SERIES } from '../../lib/chartColors';
import TimeSeriesChart from '../charts/TimeSeriesChart';
import { Badge, Card, CardHeader, Skeleton, cx } from '../ui';
import { useToast } from '../ui/toast';
import { IconArrowRight, IconBot, IconCheck, IconDocs, IconKey } from '../ui/icons';
import { Stat } from './UsagePanel';
import BotReadinessPanel from './BotReadinessPanel';

const READINESS_POLL_MS = 5000;

// The saved pre-flight audit (written at signup, or by "Run again" here).
// While the API reports one running in the background — right after signup,
// when the wizard's report couldn't be reused — it polls until it lands.
function ReadinessCard({ ws }) {
  const toast = useToast();
  const [state, setState] = useState(null); // { report, stale, running }
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer;
    const load = () => ws.getReadiness().then((s) => {
      if (!alive) return;
      setState(s);
      if (s.running) timer = setTimeout(load, READINESS_POLL_MS);
    }).catch(() => alive && setState({ report: null, stale: false, running: false }));
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [ws]);

  const run = async () => {
    setBusy(true);
    try {
      const report = await ws.runReadinessAudit();
      setState({ report, stale: false, running: false });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <Skeleton className="h-40" />;
  return <BotReadinessPanel report={state.report} stale={state.stale} loading={busy || state.running} onRun={run} />;
}

// Landing page of a workspace: are the bots live, what's left to set up, and
// how much they've been used lately. `base` is where the subpages live
// (/dashboard for clients); omit it to hide the deep links.
export default function Overview({ ws, tenant, base }) {
  const toast = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    Promise.all([ws.listDocuments(), ws.listApiKeys(), ws.listTickets(), ws.getDailyUsage(30)])
      .then(([docs, keys, tickets, daily]) => setData({ docs, keys, tickets, daily: daily.series }))
      .catch((e) => toast.error(e.message));
  }, [ws]);

  const liveKeys = data?.keys.filter((k) => !k.revokedAt) || [];
  const widgetSeen = liveKeys.some((k) => k.lastUsedAt);
  const steps = data && [
    { done: data.docs.length > 0, label: 'Add knowledge', detail: `${data.docs.length} document${data.docs.length === 1 ? '' : 's'}`, href: 'documents' },
    { done: liveKeys.length > 0, label: 'Issue an API key', detail: `${liveKeys.length} active`, href: 'keys' },
    { done: widgetSeen, label: 'Embed the widget on your site', detail: widgetSeen ? 'Widget traffic seen' : 'Waiting for the first visitor', href: 'keys' }
  ];
  const live = tenant.active && data?.docs.length > 0 && liveKeys.length > 0;
  const sum = (k) => (data?.daily || []).reduce((a, d) => a + d[k], 0);

  return (
    <div className="space-y-6">
      <Card className="relative overflow-hidden p-5">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-brand-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-obsidian/60 text-brand-300"><IconBot className="h-6 w-6" /></span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-fg">Support & Sales bots</h2>
                {data ? <Badge tone={live ? 'success' : 'warning'} dot>{live ? 'Live' : 'Setup incomplete'}</Badge> : null}
              </div>
              <p className="mt-0.5 text-sm text-fg-2">{tenant.industryLabel} · <span className="font-mono text-xs text-fg-3">{tenant.slug}</span></p>
            </div>
          </div>
          {base && <Link href={`${base}/bots`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-300 hover:text-brand-200">Test the bots <IconArrowRight className="h-4 w-4" /></Link>}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Documents" value={data && data.docs.length} />
        <Stat label="Questions · 30 days" value={data && sum('questions')} />
        <Stat label="AI answers · 30 days" value={data && sum('aiAnswers')} />
        <Stat label="Open tickets" value={data && data.tickets.filter((t) => t.status === 'open').length} />
      </div>

      <ReadinessCard ws={ws} />

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Questions per day" description="Last 30 days, all channels (widget and dashboard tests)." />
          <div className="p-5">
            {data ? <TimeSeriesChart title="Questions per day" data={data.daily} series={[{ key: 'questions', label: 'Questions', color: SERIES.blue }]} height={200} />
              : <Skeleton className="h-[220px]" />}
          </div>
        </Card>

        <Card>
          <CardHeader title="Setup" description="Three steps to answering customers." />
          <ol className="space-y-1 p-3">
            {!steps ? [0, 1, 2].map((i) => <Skeleton key={i} className="m-2 h-12" />) : steps.map((s, i) => {
              const Row = base ? Link : 'div';
              return (
                <li key={s.label}>
                  <Row href={base ? `${base}/${s.href}` : undefined} className={cx('flex items-center gap-3 rounded-lg px-3 py-2.5', base && 'hover:bg-white/[0.03]')}>
                    <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs',
                      s.done ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-white/10 text-fg-3')}>
                      {s.done ? <IconCheck className="h-3.5 w-3.5" /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block text-sm font-medium', s.done ? 'text-fg-2' : 'text-fg')}>{s.label}</span>
                      <span className="block text-xs text-fg-3">{s.detail}</span>
                    </span>
                    {i === 0 ? <IconDocs className="h-4 w-4 text-fg-3" /> : <IconKey className="h-4 w-4 text-fg-3" />}
                  </Row>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </div>
  );
}
