import { useEffect, useState } from 'react';
import { Badge, Button, Card, Checkbox, Skeleton, Spinner, cx } from '../ui';
import { IconAlert, IconBolt, IconCheck, IconShield, IconSpark } from '../ui/icons';

// The pre-flight readiness report (API: services/botAuditor.js) — used by the
// signup wizard before launch and by the workspace Overview afterwards.
// Presentational: the caller runs the audit and passes the report in.
//   report   { readinessScore, readinessLevel, pillarScores, criticalGaps,
//              recommendations, distribution, method, notice, auditedAt }
//   loading  an audit is running; error: it failed (message)
//   onRun    re-run the audit (button hidden when omitted)
//   stale    documents changed since this report
//   footer   extra content under the report (the wizard's acknowledgement)

// Colour bands: red under 50, amber 50-79, green 80+ (the API's levels).
export function scoreTone(score) {
  if (score >= 80) return { text: 'text-emerald-300', bar: 'bg-emerald-400', badge: 'success', label: 'Production Ready' };
  if (score >= 50) return { text: 'text-amber-300', bar: 'bg-amber-400', badge: 'warning', label: 'Moderate' };
  return { text: 'text-rose-300', bar: 'bg-rose-400', badge: 'danger', label: 'Not Ready' };
}

function ScoreRing({ score, size = 112 }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const [shown, setShown] = useState(0); // animates in from 0
  useEffect(() => { const t = setTimeout(() => setShown(score), 50); return () => clearTimeout(t); }, [score]);
  const tone = scoreTone(score);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`Readiness score ${score} percent`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-white/[0.07]" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} className={cx(tone.text, 'transition-[stroke-dashoffset] duration-1000 ease-out')} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cx('text-3xl font-semibold tabular-nums', tone.text)}>{score}%</span>
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-fg-3">ready</span>
      </div>
    </div>
  );
}

// subject: "Your bots" / "Your Support Bot" …; plural picks the verb forms.
const SUMMARY = {
  'Production Ready': (subject, plural = false) => `${subject} ${plural ? 'have what they need' : 'has what it needs'} to answer most customer questions without guessing.`,
  Moderate: (subject) => `${subject} can handle common questions, but the gaps below will lead to handoffs or vague answers.`,
  'Not Ready': (subject) => `${subject} would hand off or give thin answers too often. Fill the critical gaps before going live.`
};

function Distribution({ d }) {
  if (!d?.total) return null;
  // One bot deployed: it uses all the knowledge, so there's no split to show.
  if (d.deployed?.length === 1) {
    const bot = d.deployed[0];
    const Icon = bot === 'sales' ? IconBolt : IconShield;
    return (
      <p className="inline-flex items-center gap-1.5 text-xs text-fg-3">
        <Icon className={cx('h-3.5 w-3.5', bot === 'sales' ? 'text-green-300' : 'text-brand-300')} />
        {bot === 'sales' ? 'Sales' : 'Support'} Bot only: it answers from all <b className="font-medium text-fg-2">{d.total}</b> sections.
      </p>
    );
  }
  const pct = (n) => `${Math.max(0, (n / d.total) * 100)}%`;
  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
        <span className="bg-brand-400" style={{ width: pct(d.support) }} />
        <span className="bg-fg-3/60" style={{ width: pct(d.both) }} />
        <span className="bg-green-400" style={{ width: pct(d.sales) }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
        <span className="inline-flex items-center gap-1.5"><IconShield className="h-3.5 w-3.5 text-brand-300" />Support Bot: <b className="font-medium text-fg-2">{d.supportBot}</b> sections ({d.support} its own)</span>
        <span className="inline-flex items-center gap-1.5"><IconBolt className="h-3.5 w-3.5 text-green-300" />Sales Bot: <b className="font-medium text-fg-2">{d.salesBot}</b> sections ({d.sales} its own)</span>
        <span>{d.both} shared</span>
      </div>
    </div>
  );
}

const BOT_META = {
  support: { name: 'Support Bot', icon: IconShield, accent: 'text-brand-300', trainedOn: 'troubleshooting manuals, FAQs, hours and support policies' },
  sales: { name: 'Sales Bot', icon: IconBolt, accent: 'text-green-300', trainedOn: 'pricing tiers, product features, pitch and sales material' }
};

// One tab per deployed bot: its own training %, the pillars it's trained on,
// what's missing (a checklist) and what to add.
function PerBotReport({ report, loading, onRun, stale, footer, title }) {
  const bots = Object.keys(report.bots).filter((b) => BOT_META[b]);
  const [active, setActive] = useState(bots[0]);
  const [checked, setChecked] = useState({});
  useEffect(() => { setChecked({}); setActive(bots[0]); }, [report.auditedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const bot = report.bots[active] || report.bots[bots[0]];
  const meta = BOT_META[active] || BOT_META[bots[0]];
  const tone = scoreTone(bot.score);
  const overall = scoreTone(report.readinessScore);
  const handled = bot.criticalGaps.filter((_, i) => checked[`${active}:${i}`]).length;

  // Arrow keys move between tabs, like a native tablist.
  const onKeyDown = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step || bots.length < 2) return;
    e.preventDefault();
    const next = bots[(bots.indexOf(active) + step + bots.length) % bots.length];
    setActive(next);
    document.getElementById(`readiness-tab-${next}`)?.focus();
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-white/[0.06] p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-fg">{title}</h3>
            <Badge tone={overall.badge} dot>{report.readinessLevel}</Badge>
            {stale && <Badge tone="warning">Documents changed since</Badge>}
            {report.method === 'heuristic' && <Badge>Estimate</Badge>}
          </div>
          <p className="text-[13px] text-fg-3">
            {bots.length > 1 ? 'Each bot is trained on its own material. You\'re ready to launch when every bot reaches 80%.' : `Ready to launch at 80%.`}
          </p>
          {report.notice && <p className="text-xs text-amber-200">{report.notice}</p>}
        </div>
        {onRun && (
          <Button size="sm" onClick={onRun} loading={loading} className="self-start">
            {loading ? 'Checking…' : stale ? 'Check again' : 'Run again'}
          </Button>
        )}
      </div>

      {/* Bot toggle: each tab shows that bot's training % */}
      <div role="tablist" aria-label="Bots" onKeyDown={onKeyDown} className={cx('grid gap-2 border-b border-white/[0.06] p-3', bots.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
        {bots.map((b) => {
          const m = BOT_META[b];
          const t = scoreTone(report.bots[b].score);
          const selected = b === active;
          const Icon = m.icon;
          return (
            <button key={b} id={`readiness-tab-${b}`} type="button" role="tab" aria-selected={selected} aria-controls={`readiness-panel-${b}`}
              tabIndex={selected ? 0 : -1} onClick={() => setActive(b)}
              className={cx('flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/20',
                selected ? 'border-white/20 bg-white/[0.06]' : 'border-white/[0.06] hover:bg-white/[0.03]')}>
              <span className="flex min-w-0 items-center gap-2.5">
                <Icon className={cx('h-4 w-4 shrink-0', m.accent)} />
                <span className="truncate text-sm font-medium text-fg">{m.name}</span>
              </span>
              <span className={cx('text-lg font-semibold tabular-nums', t.text)}>{report.bots[b].score}%</span>
            </button>
          );
        })}
      </div>

      <div id={`readiness-panel-${active}`} role="tabpanel" aria-labelledby={`readiness-tab-${active}`}>
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <ScoreRing score={bot.score} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-fg">{meta.name} training</span>
              <Badge tone={tone.badge} dot>{bot.level}</Badge>
            </div>
            <p className="text-[13px] text-fg-2">
              {SUMMARY[bot.level]?.(`Your ${meta.name}`)}
            </p>
            <p className="text-xs text-fg-3">
              Trained on {meta.trainedOn} · {bot.sections} section{bot.sections === 1 ? '' : 's'} ({bot.characters.toLocaleString()} characters) it can use.
            </p>
          </div>
        </div>

        <div className="grid gap-x-6 gap-y-3 border-t border-white/[0.06] p-6 sm:grid-cols-2">
          {bot.pillars.map((p) => {
            const t = scoreTone(p.score);
            return (
              <div key={p.id} className="min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[13px] font-medium text-fg">{p.label}</span>
                  <span className="shrink-0 text-[13px] tabular-nums">
                    <span className="mr-1.5 text-[11px] text-fg-3">{p.weight}% of score</span>
                    <span className={cx('font-semibold', t.text)}>{p.score}%</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className={cx('h-full rounded-full transition-[width] duration-700', t.bar)} style={{ width: `${p.score}%` }} />
                </div>
                {p.summary && <p className="mt-1 line-clamp-2 text-xs text-fg-3">{p.summary}</p>}
              </div>
            );
          })}
        </div>

        <div className="grid gap-6 border-t border-white/[0.06] p-6 lg:grid-cols-2">
          <section>
            <div className="mb-3 flex items-center justify-between gap-2">
              <h4 className="text-[11px] font-medium uppercase tracking-[0.1em] text-fg-3">Missing for the {meta.name}</h4>
              {bot.criticalGaps.length > 0 && <span className="text-xs text-fg-3 tabular-nums">{handled}/{bot.criticalGaps.length} reviewed</span>}
            </div>
            {bot.criticalGaps.length === 0 ? (
              <p className="flex items-center gap-2 text-[13px] text-emerald-200"><IconCheck className="h-4 w-4" />Nothing critical is missing.</p>
            ) : (
              <ul className="space-y-2">
                {bot.criticalGaps.map((g, i) => {
                  const key = `${active}:${i}`;
                  return (
                    <li key={key} className={cx('rounded-lg border px-3 py-2 transition', checked[key] ? 'border-white/[0.06] bg-white/[0.02] opacity-60' : 'border-amber-400/20 bg-amber-400/[0.05]')}>
                      <Checkbox checked={!!checked[key]} onChange={(e) => setChecked((c) => ({ ...c, [key]: e.target.checked }))}>
                        <span className={cx('inline-flex items-start gap-1.5', checked[key] && 'line-through')}>
                          <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />{g}
                        </span>
                      </Checkbox>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section>
            <h4 className="mb-3 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-3">Add to fully train it</h4>
            {bot.requirements.length === 0 ? (
              <p className="text-[13px] text-fg-3">Nothing essential — keep your documents up to date.</p>
            ) : (
              <ol className="space-y-2">
                {bot.requirements.map((r, i) => (
                  <li key={r} className="flex gap-2.5 text-[13px] leading-relaxed text-fg-2">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-400/10 text-[11px] font-medium text-brand-200">{i + 1}</span>
                    {r}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      <div className="space-y-3 border-t border-white/[0.06] px-6 py-4">
        <Distribution d={report.distribution} />
        {footer}
        {report.auditedAt && <p className="text-[11.5px] text-fg-3">Checked {new Date(report.auditedAt).toLocaleString()}{report.stats ? ` · ${report.stats.documents} documents, ${report.stats.sections} sections` : ''}</p>}
      </div>
    </Card>
  );
}

export default function BotReadinessPanel({ report, loading, error, onRun, stale, footer, title = 'Bot readiness' }) {
  const [checked, setChecked] = useState({});
  useEffect(() => { setChecked({}); }, [report?.auditedAt]);

  if (loading && !report) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-5">
          <Skeleton className="h-28 w-28 rounded-full" />
          <div className="flex-1 space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-fg"><Spinner className="h-4 w-4" />Checking how well each bot is trained…</p>
            <p className="text-[13px] text-fg-3">Reading your documents for each bot: support material, pricing, features and sales arguments. Usually 10–30 seconds.</p>
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card className="p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-fg">{title}</p>
            <p className="mt-0.5 text-[13px] text-fg-3">{error || 'See how well your documents train each bot, and what to add before going live.'}</p>
          </div>
          {onRun && <Button variant="primary" onClick={onRun} loading={loading}><IconSpark className="h-4 w-4" />Run training check</Button>}
        </div>
      </Card>
    );
  }

  // Current reports carry a separate training score per bot; reports saved
  // before that fall through to the single-score layout below.
  if (report.bots && Object.keys(report.bots).length) {
    return <PerBotReport report={report} loading={loading} onRun={onRun} stale={stale} footer={footer} title={title} />;
  }

  const tone = scoreTone(report.readinessScore);
  const gaps = report.criticalGaps || [];
  const handled = gaps.filter((_, i) => checked[i]).length;

  return (
    <Card>
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
        <ScoreRing score={report.readinessScore} />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-fg">{title}</h3>
            <Badge tone={tone.badge} dot>{report.readinessLevel}</Badge>
            {stale && <Badge tone="warning">Documents changed since</Badge>}
            {report.method === 'heuristic' && <Badge>Estimate</Badge>}
          </div>
          <p className="text-sm text-fg-2">{report.distribution?.deployed?.length === 1 ? SUMMARY[report.readinessLevel]?.('Your bot') : SUMMARY[report.readinessLevel]?.('Your bots', true)}</p>
          {report.notice && <p className="text-xs text-amber-200">{report.notice}</p>}
          <Distribution d={report.distribution} />
        </div>
        {onRun && (
          <Button size="sm" onClick={onRun} loading={loading} className="self-start">
            {loading ? 'Auditing…' : stale ? 'Re-run audit' : 'Run again'}
          </Button>
        )}
      </div>

      <div className="grid gap-x-6 gap-y-3 border-t border-white/[0.06] p-6 sm:grid-cols-2">
        {report.pillarScores.map((p) => {
          const t = scoreTone(p.score);
          // inScope false: the other bot's specialty when only one is deployed — not part of the score.
          const outOfScope = p.inScope === false;
          return (
            <div key={p.id} className={cx('min-w-0', outOfScope && 'opacity-45')} title={outOfScope ? 'Not counted: this bot isn\'t deployed' : undefined}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[13px] font-medium text-fg">{p.label}</span>
                {outOfScope
                  ? <span className="shrink-0 text-[11px] text-fg-3">Not in scope</span>
                  : <span className={cx('text-[13px] font-semibold tabular-nums', t.text)}>{p.score}%</span>}
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div className={cx('h-full rounded-full transition-[width] duration-700', t.bar)} style={{ width: `${p.score}%` }} />
              </div>
              {p.summary && <p className="mt-1 line-clamp-2 text-xs text-fg-3">{p.summary}</p>}
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 border-t border-white/[0.06] p-6 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-[11px] font-medium uppercase tracking-[0.1em] text-fg-3">Critical knowledge gaps</h4>
            {gaps.length > 0 && <span className="text-xs text-fg-3 tabular-nums">{handled}/{gaps.length} reviewed</span>}
          </div>
          {gaps.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-emerald-200"><IconCheck className="h-4 w-4" />No critical gaps found.</p>
          ) : (
            <ul className="space-y-2">
              {gaps.map((g, i) => (
                <li key={g} className={cx('rounded-lg border px-3 py-2 transition', checked[i] ? 'border-white/[0.06] bg-white/[0.02] opacity-60' : 'border-amber-400/20 bg-amber-400/[0.05]')}>
                  <Checkbox checked={!!checked[i]} onChange={(e) => setChecked((c) => ({ ...c, [i]: e.target.checked }))}>
                    <span className={cx('inline-flex items-start gap-1.5', checked[i] && 'line-through')}>
                      <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />{g}
                    </span>
                  </Checkbox>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4 className="mb-3 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-3">What to add next</h4>
          {(report.recommendations || []).length === 0 ? (
            <p className="text-[13px] text-fg-3">Nothing essential — keep your documents up to date.</p>
          ) : (
            <ol className="space-y-2">
              {report.recommendations.map((r, i) => (
                <li key={r} className="flex gap-2.5 text-[13px] leading-relaxed text-fg-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-400/10 text-[11px] font-medium text-brand-200">{i + 1}</span>
                  {r}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {(footer || report.auditedAt) && (
        <div className="space-y-3 border-t border-white/[0.06] px-6 py-4">
          {footer}
          {report.auditedAt && <p className="text-[11.5px] text-fg-3">Audited {new Date(report.auditedAt).toLocaleString()}{report.stats ? ` · ${report.stats.documents} documents, ${report.stats.sections} sections` : ''}</p>}
        </div>
      )}
    </Card>
  );
}
