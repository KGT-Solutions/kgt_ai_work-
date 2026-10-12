import { useEffect, useState } from 'react';
import { Button, Spinner, cx } from '../ui';
import { IconAlert, IconChevronDown, IconSpark } from '../ui/icons';
import BotReadinessPanel, { scoreTone } from './BotReadinessPanel';

// On-demand training check, embedded where knowledge is managed (the signup
// wizard's Knowledge step, the dashboard Documents page and Overview).
// Collapsed it's one row: a "Run Bot Training Check" button, or once a
// report exists, each bot's training % and a show/hide toggle. Running a
// check opens the full per-bot breakdown (BotReadinessPanel) below; the user
// can close it and go back to adding documents at any time.
//   report  the latest report, or null      loading  a check is running
//   error   the last check failed (message) stale    knowledge changed since
//   onRun   run a (new) check               onOpen   called when opened with
//                                                    no report yet (e.g. to load a saved one)
const POLL_MS = 5000;

/**
 * The drawer wired to a workspace (dashboard Documents and Overview). The saved
 * report is read on mount — a cheap GET, no AI call — so the row can show the
 * last scores; a new check (an AI call billed to the tenant) runs only when
 * the user asks, or when there's no report or it's stale. While the API says
 * one is running in the background (right after signup), it polls.
 * refreshKey: change it after documents change, to pick up the stale flag.
 */
export function WorkspaceTrainingCheck({ ws, refreshKey = 0, title }) {
  const [state, setState] = useState({ report: null, stale: false, running: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    let timer;
    const load = () => ws.getReadiness().then((s) => {
      if (!alive) return;
      setState(s);
      if (s.running) timer = setTimeout(load, POLL_MS);
    }).catch(() => {}); // the button still works without the saved report
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, [ws, refreshKey]);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const report = await ws.runReadinessAudit();
      setState({ report, stale: false, running: false });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return <TrainingCheckDrawer report={state.report} stale={state.stale} loading={busy || state.running} error={error} onRun={run} title={title} />;
}

export default function TrainingCheckDrawer({ report, loading, error, stale, onRun, onOpen, defaultOpen = false, title = 'Bot training' }) {
  const [open, setOpen] = useState(defaultOpen);
  // A check that just started or finished opens the drawer.
  useEffect(() => { if (loading) setOpen(true); }, [loading]);

  const run = () => { setOpen(true); onRun(); };
  const toggle = () => {
    if (!open && !report && onOpen) onOpen();
    setOpen((o) => !o);
  };
  const bots = report?.bots ? Object.entries(report.bots) : [];

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-obsidian/60 text-brand-300">
            {loading ? <Spinner className="h-4 w-4" /> : <IconSpark className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-fg">{title}</p>
            <p className="truncate text-xs text-fg-3" aria-live="polite">
              {loading ? 'Checking how well each bot is trained…'
                : error ? 'The last check could not run.'
                  : bots.length ? (stale ? 'Your knowledge changed since the last check.' : 'Latest check')
                    : 'See how well your knowledge trains each bot, and what to add.'}
            </p>
          </div>
          {!loading && bots.length > 0 && (
            <span className="ml-1 hidden items-center gap-2 sm:flex">
              {bots.map(([bot, b]) => (
                <span key={bot} className={cx('rounded-full border border-white/10 px-2 py-0.5 text-[11.5px] font-semibold tabular-nums', scoreTone(b.score).text, stale && 'opacity-60')}>
                  {bot === 'sales' ? 'Sales' : 'Support'} {b.score}%
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(report || error) && (
            <button type="button" onClick={toggle} aria-expanded={open}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-fg-2 hover:bg-white/[0.05] hover:text-fg">
              {open ? 'Hide' : 'Show'}<IconChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
            </button>
          )}
          {(!report || stale) && (
            <Button size="sm" variant="primary" onClick={run} loading={loading}>
              {loading ? 'Checking…' : stale ? 'Check again' : 'Run Bot Training Check'}
            </Button>
          )}
        </div>
      </div>

      {/* grid-rows 0fr -> 1fr animates to the content's real height */}
      <div className={cx('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-white/[0.06] p-3">
            {error && !loading && !report ? (
              <p className="flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-100" role="alert">
                <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />{error}
              </p>
            ) : (
              <BotReadinessPanel title="Training readiness" report={report} loading={loading} error={error} stale={stale} onRun={run} />
            )}
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => setOpen(false)} className="text-xs font-medium text-fg-3 hover:text-fg-2">Close</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
