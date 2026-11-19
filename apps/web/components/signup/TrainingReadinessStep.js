import { useRef, useState } from 'react';
import { Button, Card, Spinner, cx } from '../ui';
import { IconAlert, IconArrowLeft, IconArrowRight, IconBolt, IconCheck, IconChevronDown, IconShield, IconUpload } from '../ui/icons';
import { api } from '../../lib/api';
import { scoreTone } from '../workspace/BotReadinessPanel';

// Signup wizard: the training screen shown automatically after the Knowledge
// step (the parent runs the audit as the visitor arrives). At a glance:
//   - one big, colour-coded training % per deployed bot (red / amber / green);
//   - "Path to 100% training": plain-English requirements per bot. Each explains
//     why it matters (what it is / why / how the bot uses it), has an Upload
//     button (parsed → added → the check re-runs), and an "Optional / Not
//     applicable" dismiss that drops it from the score instantly (lib/readiness.js).
// The visitor continues once the check has finished (or failed — an outage
// never blocks signup); a low score is advice, not a gate.

const BOTS = {
  support: { name: 'Support Bot', icon: IconShield, accent: 'text-brand-300' },
  sales: { name: 'Sales Bot', icon: IconBolt, accent: 'text-green-300' }
};
const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.zip,application/pdf,application/zip,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_ZIP_MB = 25;
const MAX_FILE_MB = 10;

// Plain-language label per colour band.
const STATUS = { 'Production Ready': 'Ready', Moderate: 'Almost there', 'Not Ready': 'Needs more knowledge' };

function ScoreCard({ bot, data, checking }) {
  const meta = BOTS[bot];
  const tone = scoreTone(data.score);
  const Icon = meta.icon;
  return (
    <Card className="p-5" role="group" aria-label={`${meta.name} training`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Icon className={cx('h-4 w-4', meta.accent)} />{meta.name} training
        </span>
        {checking && <Spinner className="h-4 w-4 text-fg-3" />}
      </div>
      <p className={cx('mt-3 text-5xl font-semibold tabular-nums tracking-tight transition-colors', tone.text, checking && 'opacity-60')}>
        {data.score}%
      </p>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
        <div className={cx('h-full rounded-full transition-[width] duration-700', tone.bar)} style={{ width: `${data.score}%` }} />
      </div>
      <p className={cx('mt-2 text-[13px] font-medium', tone.text)}>{STATUS[data.level] || data.level}</p>
    </Card>
  );
}

// An enriched, dismissible requirement: the ask, a "why this matters" disclosure
// (what it is / why / how the bot uses it), an Upload button, and a dismiss.
function RequirementItem({ item, botName, busy, result, onUpload, onDismiss }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  return (
    <li className="rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[13.5px] leading-relaxed text-fg">
            <span className="font-medium">To raise your {botName}:</span> {item.text.replace(/\.$/, '')}.
          </p>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200">
            <IconChevronDown className={cx('h-3.5 w-3.5 transition', open && 'rotate-180')} />Why this matters
          </button>
          {result && <p className={cx('mt-1 text-xs', result.ok ? 'text-emerald-300' : 'text-rose-300')}>{result.text}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { onUpload(e.target.files); e.target.value = ''; }} />
          <Button size="sm" onClick={() => inputRef.current?.click()} loading={busy}>
            {!busy && <IconUpload className="h-4 w-4" />}Upload
          </Button>
          <button type="button" onClick={onDismiss}
            className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-medium text-fg-3 transition hover:bg-white/[0.04] hover:text-fg-2">
            Not applicable
          </button>
        </div>
      </div>
      {open && (
        <dl className="grid gap-2 border-t border-white/[0.06] px-4 py-3 text-[12.5px] sm:grid-cols-3">
          <div><dt className="font-medium text-fg-2">What it is</dt><dd className="mt-0.5 text-fg-3">{item.description}</dd></div>
          <div><dt className="font-medium text-fg-2">Why it matters</dt><dd className="mt-0.5 text-fg-3">{item.importance}</dd></div>
          <div><dt className="font-medium text-fg-2">How your bot uses it</dt><dd className="mt-0.5 text-fg-3">{item.botUtility}</dd></div>
        </dl>
      )}
    </li>
  );
}

// Legacy fallback: a report with no requirementItems (saved before this feature).
function LegacyRequirement({ bot, text, onUpload, busy, result }) {
  const inputRef = useRef(null);
  const meta = BOTS[bot];
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-[13.5px] leading-relaxed text-fg">
          <span className="font-medium">To reach 100% on your {meta.name}:</span> {text.replace(/\.$/, '')}.
        </p>
        {result && <p className={cx('mt-1 text-xs', result.ok ? 'text-emerald-300' : 'text-rose-300')}>{result.text}</p>}
      </div>
      <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { onUpload(e.target.files); e.target.value = ''; }} />
      <Button size="sm" onClick={() => inputRef.current?.click()} loading={busy} className="shrink-0">
        {!busy && <IconUpload className="h-4 w-4" />}Upload
      </Button>
    </li>
  );
}

export default function TrainingReadinessStep({ audit, botsDeployed, ignored, onToggleIgnored, onAddPages, onRecheck, onBack, onNext }) {
  const [uploading, setUploading] = useState(null); // requirement key
  const [results, setResults] = useState({});
  const report = audit.report;
  const checking = audit.loading;
  const bots = botsDeployed.filter((b) => report?.bots?.[b]);
  const ignoredSet = ignored instanceof Set ? ignored : new Set(ignored || []);

  const upload = async (key, files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setUploading(key);
    let added = 0;
    const notes = [];
    for (const f of list) {
      try {
        if (!/\.(pdf|docx|txt|md|markdown|zip)$/i.test(f.name)) throw new Error('use PDF, Word, TXT, MD or ZIP');
        const limit = /\.zip$/i.test(f.name) ? MAX_ZIP_MB : MAX_FILE_MB;
        if (f.size > limit * 1024 * 1024) throw new Error(`larger than ${limit}MB`);
        const data = await api.analyzeCompanyFile(f);
        onAddPages(data.pages);
        added += data.pages.length;
        notes.push(`${f.name} added`);
      } catch (err) {
        notes.push(`${f.name}: ${err.message}`);
      }
    }
    setUploading(null);
    // The parent re-runs the check by itself once the new pages are in its list.
    setResults((r) => ({ ...r, [key]: { ok: added > 0, text: added ? `${notes.join(' · ')} — re-checking your training…` : notes.join(' · ') } }));
  };

  // Enriched items (current reports) vs. the legacy string list (old reports).
  const allItems = bots.flatMap((bot) => (report?.bots?.[bot]?.requirementItems || []).map((it) => ({ ...it, bot })));
  const hasItems = allItems.length > 0;
  const active = allItems.filter((it) => !ignoredSet.has(it.key));
  const dismissed = allItems.filter((it) => ignoredSet.has(it.key));

  // Legacy fallback path (no requirementItems on the report).
  const legacyPath = hasItems ? [] : bots.flatMap((bot) => {
    const b = report.bots[bot];
    const items = b.requirements.length ? b.requirements : b.score < 100 ? b.criticalGaps.map((g) => `add content covering this: ${g}`) : [];
    return items.map((text, i) => ({ key: `${bot}:${i}:${text}`, bot, text }));
  });
  const nothingLeft = hasItems ? active.length === 0 : legacyPath.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-fg">Your bots&apos; training</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-fg-2">
          How well your knowledge prepares each bot to answer customers without guessing.
        </p>
      </div>

      {!report && checking && (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Spinner className="h-7 w-7 text-brand-300" />
          <p className="text-sm font-medium text-fg">Analyzing your website and documents…</p>
          <p className="text-[13px] text-fg-3">Checking support material, pricing, features and sales content for each bot. Usually 10–30 seconds.</p>
        </Card>
      )}

      {!report && !checking && audit.error && (
        <Card className="space-y-3 p-6">
          <p className="flex items-start gap-2 text-sm text-rose-100"><IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />{audit.error}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={onRecheck}>Try again</Button>
            <span className="self-center text-xs text-fg-3">or continue — the check runs again after launch.</span>
          </div>
        </Card>
      )}

      {report && (
        <>
          <div className={cx('grid gap-4', bots.length > 1 && 'sm:grid-cols-2')}>
            {bots.map((bot) => <ScoreCard key={bot} bot={bot} data={report.bots[bot]} checking={checking} />)}
          </div>
          {audit.error && <p className="text-center text-xs text-amber-200">{audit.error}</p>}
          {report.notice && <p className="text-center text-xs text-amber-200">{report.notice}</p>}

          <Card>
            <div className="border-b border-white/[0.06] px-5 py-4">
              <h3 className="text-sm font-semibold text-fg">Path to 100% training</h3>
              <p className="mt-0.5 text-[13px] text-fg-3">
                {nothingLeft
                  ? 'Nothing is missing. Your bots are fully trained.'
                  : 'Add these to raise your training. Upload right here (we re-check automatically), or mark anything that doesn’t apply to your business as Optional.'}
              </p>
            </div>

            {hasItems ? (
              <>
                {active.length > 0 ? (
                  <ul className="space-y-2 p-4">
                    {active.map((item) => (
                      <RequirementItem key={item.key} item={item} botName={BOTS[item.bot].name}
                        busy={uploading === item.key} result={results[item.key]}
                        onUpload={(files) => upload(item.key, files)} onDismiss={() => onToggleIgnored(item.key)} />
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-center gap-2 p-5 text-sm text-emerald-200"><IconCheck className="h-4 w-4" />
                    Every remaining item is handled or dismissed — your bots are ready.
                  </p>
                )}
                {dismissed.length > 0 && (
                  <div className="border-t border-white/[0.06] p-4">
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-3">Dismissed as not applicable ({dismissed.length})</p>
                    <ul className="space-y-1.5">
                      {dismissed.map((it) => (
                        <li key={it.key} className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-white/10 px-3 py-2">
                          <span className="truncate text-[13px] text-fg-3 line-through">{it.text}</span>
                          <button type="button" onClick={() => onToggleIgnored(it.key)} className="shrink-0 text-xs font-medium text-brand-300 hover:text-brand-200">Undo</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : legacyPath.length > 0 ? (
              <ul className="space-y-2 p-4">
                {legacyPath.map((item) => (
                  <LegacyRequirement key={item.key} bot={item.bot} text={item.text} busy={uploading === item.key}
                    result={results[item.key]} onUpload={(files) => upload(item.key, files)} />
                ))}
              </ul>
            ) : (
              <p className="flex items-center gap-2 p-5 text-sm text-emerald-200"><IconCheck className="h-4 w-4" />Every deployed bot is fully trained.</p>
            )}
          </Card>
        </>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button onClick={onBack} disabled={checking}><IconArrowLeft className="h-4 w-4" />Back to knowledge</Button>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <Button variant="primary" onClick={onNext} disabled={checking || (!report && !audit.error)}>
            Continue to review <IconArrowRight className="h-4 w-4" />
          </Button>
          {checking && <span className="text-xs text-fg-3">Waiting for the training check…</span>}
        </div>
      </div>
    </div>
  );
}
