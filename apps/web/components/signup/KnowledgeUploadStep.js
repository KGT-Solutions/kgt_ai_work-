import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Checkbox, Input, Select, Spinner, Textarea, cx } from '../ui';
import { IconAlert, IconArrowLeft, IconArrowRight, IconCheck, IconChevronDown, IconDocs, IconGlobe, IconPencil, IconUpload } from '../ui/icons';
import { api } from '../../lib/api';
import { DOC_CATEGORIES, categoryLabel } from '../../lib/documentCategories';
import { BOT_SCOPES, DEFAULT_BOT_SCOPE } from '../../lib/botScopes';

// Signup wizard: the knowledge the bots train on, in one compact card.
//   - Documents: PDF, Word (.docx), .txt / .md, or a .zip of them for bulk
//     upload (API: POST /register/analyze-file — parsed, nothing saved yet).
//   - Website: a URL, scanned only after the legal authorization box is ticked
//     (the API refuses to crawl without it, and records it at signup).
// Everything found lands in one list below to review, edit, re-file or
// remove. "Analyze & continue" moves to the Training step, which checks the
// knowledge automatically (TrainingReadinessStep.js). The parent owns the list.

// Must match CRAWL_CONSENT_STATEMENT in apps/api/src/services/shared/crawlConsent.js.
export const CRAWL_CONSENT_TEXT =
  'I am an authorized representative and legally permit the KGT Solutions AI crawler to access and extract content from this domain.';
const CRAWL_STATUS = ['Crawling website pages…', 'Removing menus, footers and page noise…', 'Extracting FAQs, pricing and support content…', 'Structuring extracted content…'];
const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.zip,application/pdf,application/zip,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_ZIP_MB = 25;
const MAX_FILE_MB = 10;
const isAccepted = (f) => /\.(pdf|docx|txt|md|markdown|zip)$/i.test(f.name);
const isZip = (f) => /\.zip$/i.test(f.name);

export default function KnowledgeUploadStep({
  pages, trainableCount, maxEntries, onAddPages, updatePage, addEntry,
  website, onBack, onNext
}) {
  const live = pages.filter((p) => !p.deleted);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <div className="border-b border-white/[0.06] px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Add your knowledge</h2>
          <p className="mt-0.5 text-[13px] text-fg-3">Upload documents, scan your website, or both. You can review everything below.</p>
        </div>
        <div className="space-y-5 p-5">
          <UploadBox onAddPages={onAddPages} />
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-fg-3" aria-hidden="true">
            <span className="h-px flex-1 bg-white/[0.06]" />and / or<span className="h-px flex-1 bg-white/[0.06]" />
          </div>
          <WebsiteBox {...website} />
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
          <h3 className="text-sm font-semibold text-fg">Your knowledge</h3>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => addEntry()} className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200">
              <IconPencil className="h-3.5 w-3.5" />Write an entry
            </button>
            <Badge tone={trainableCount > maxEntries ? 'warning' : 'neutral'}>{trainableCount} / {maxEntries}</Badge>
          </div>
        </div>
        <div className="space-y-1.5 p-3">
          {live.length === 0 && pages.length === 0 ? (
            <p className="px-2 py-6 text-center text-[13px] text-fg-3">Nothing yet — upload a document or scan your website above.</p>
          ) : pages.map((p) => <EntryRow key={p.id} page={p} onChange={(patch) => updatePage(p.id, patch)} />)}
        </div>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button onClick={onBack} disabled={website.scanning}><IconArrowLeft className="h-4 w-4" />Back</Button>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <Button variant="primary" onClick={onNext} disabled={website.scanning || trainableCount === 0 || trainableCount > maxEntries}>
            Analyze & continue <IconArrowRight className="h-4 w-4" />
          </Button>
          {trainableCount === 0 && <span className="text-xs text-fg-3">Add at least one document or website page.</span>}
          {trainableCount > maxEntries && <span className="text-xs text-amber-200">Remove {trainableCount - maxEntries} entries to continue.</span>}
        </div>
      </div>
    </div>
  );
}

function UploadBox({ onAddPages }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState([]);
  const inputRef = useRef(null);

  const handleFiles = async (list) => {
    const files = Array.from(list || []);
    if (!files.length || busy) return;
    const out = [];
    for (const f of files) {
      setBusy(f.name);
      try {
        if (!isAccepted(f)) throw new Error('use PDF, Word (.docx), .txt, .md or .zip');
        const limit = isZip(f) ? MAX_ZIP_MB : MAX_FILE_MB;
        if (f.size > limit * 1024 * 1024) throw new Error(`larger than ${limit}MB`);
        const data = await api.analyzeCompanyFile(f);
        onAddPages(data.pages);
        const skipped = (data.files || []).filter((x) => !x.ok);
        const read = (data.files || []).filter((x) => x.ok).length;
        out.push({
          ok: true,
          text: isZip(f)
            ? `${f.name}: ${read} document${read === 1 ? '' : 's'} → ${data.pages.length} entr${data.pages.length === 1 ? 'y' : 'ies'}${skipped.length ? `, ${skipped.length} skipped` : ''}`
            : `${f.name}: ${data.pages.length} entr${data.pages.length === 1 ? 'y' : 'ies'}`,
          skipped
        });
      } catch (err) {
        out.push({ ok: false, text: `${f.name}: ${err.message}` });
      }
    }
    setBusy('');
    setResults(out);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
        className={cx('relative flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-3 transition focus-within:ring-4 focus-within:ring-brand-400/10',
          drag ? 'border-brand-400/70 bg-brand-400/[0.06]' : 'border-white/15 hover:border-white/25 hover:bg-white/[0.02]')}>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="absolute h-px w-px opacity-0" disabled={!!busy}
          onChange={(e) => handleFiles(e.target.files)} aria-label="Upload documents" />
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-brand-300">
          {busy ? <Spinner className="h-4 w-4" /> : <IconUpload className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-fg">{busy ? `Reading ${busy}…` : 'Upload documents'}</span>
          <span className="block text-xs text-fg-3">PDF, Word, TXT or MD · or a ZIP of them for bulk upload · up to {MAX_ZIP_MB}MB</span>
        </span>
        <span className="hidden shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-fg-2 sm:inline">Browse</span>
      </label>
      {results.length > 0 && (
        <ul className="mt-2 space-y-1" aria-live="polite">
          {results.map((r, i) => (
            <li key={i} className={cx('text-xs', r.ok ? 'text-emerald-300' : 'text-rose-300')}>
              {r.text}
              {r.skipped?.length > 0 && (
                <details className="mt-0.5 text-fg-3">
                  <summary className="cursor-pointer select-none">Show skipped files</summary>
                  <ul className="ml-3 mt-1 space-y-0.5">{r.skipped.map((s) => <li key={s.name}>{s.name} — {s.reason}</li>)}</ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WebsiteBox({ url, setUrl, consent, setConsent, scanning, scanError, crawl, onScan }) {
  const [statusIndex, setStatusIndex] = useState(0);
  useEffect(() => {
    if (!scanning) return undefined;
    setStatusIndex(0);
    const id = setInterval(() => setStatusIndex((i) => Math.min(i + 1, CRAWL_STATUS.length - 1)), 2200);
    return () => clearInterval(id);
  }, [scanning]);
  const canScan = consent && url.trim() && !scanning;

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (canScan) onScan(); }} noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <IconGlobe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourcompany.com" className="pl-9"
            disabled={scanning} aria-label="Company website" />
        </div>
        <Button type="submit" disabled={!canScan} loading={scanning}>{scanning ? 'Scanning…' : crawl ? 'Scan again' : 'Scan website'}</Button>
      </div>
      <div className={cx('rounded-lg border px-3 py-2.5 transition', consent ? 'border-white/[0.07] bg-white/[0.02]' : 'border-amber-400/20 bg-amber-400/[0.04]')}>
        <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={scanning}>
          <span className="text-[12.5px]">{CRAWL_CONSENT_TEXT}</span>
        </Checkbox>
      </div>
      {!consent && url.trim() && !scanning && <p className="text-xs text-amber-200">Tick the authorization box to scan this domain.</p>}
      {scanning && <p className="flex items-center gap-2 text-[13px] text-brand-200" aria-live="polite"><Spinner className="h-4 w-4" />{CRAWL_STATUS[statusIndex]}</p>}
      {!scanning && scanError && (
        <p className="flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-100" role="alert">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />{scanError} JavaScript-only or protected sites often can&apos;t be scanned — upload documents instead.
        </p>
      )}
      {!scanning && !scanError && crawl && (
        <p className="flex items-center gap-2 text-[13px] text-emerald-200" aria-live="polite"><IconCheck className="h-4 w-4" />
          Added {crawl.crawled} page{crawl.crawled === 1 ? '' : 's'} from {crawl.baseHost}{crawl.skipped ? ` (skipped ${crawl.skipped} thin pages)` : ''}.
        </p>
      )}
    </form>
  );
}

function EntryRow({ page, onChange }) {
  const [open, setOpen] = useState(!!page.autoExpand);
  if (page.deleted) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-dashed border-white/10 px-3 py-2">
        <span className="truncate text-[13px] text-fg-3 line-through">{page.title || 'Untitled entry'}</span>
        <button type="button" onClick={() => onChange({ deleted: false })} className="text-xs font-medium text-brand-300">Undo</button>
      </div>
    );
  }
  const Icon = page.url ? IconGlobe : page.sourceFile ? IconDocs : IconPencil;
  const source = page.url || page.sourceFile || 'Written by you';

  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.02]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        <Icon className="h-4 w-4 shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-fg">{page.title || 'Untitled entry'}</span>
          <span className="block truncate text-[11px] text-fg-3">{source}</span>
        </span>
        <span className="hidden shrink-0 text-[11px] text-fg-3 sm:inline">{categoryLabel(page.category)}</span>
        <IconChevronDown className={cx('h-4 w-4 shrink-0 text-fg-3 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/[0.06] p-3">
          <Input value={page.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title, e.g. Shipping & returns" aria-label="Entry title" />
          <Textarea value={page.content} onChange={(e) => onChange({ content: e.target.value })} className="font-mono text-[12.5px]" aria-label="Entry content"
            placeholder={'## A question or topic\nThe answer, in plain words.\n\n## Another topic\n…'} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-fg-3">
                Type
                <Select value={page.category} onChange={(e) => onChange({ category: e.target.value })} className="h-8 w-auto text-xs">
                  {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.short}</option>)}
                </Select>
              </label>
              <label className="flex items-center gap-2 text-xs text-fg-3" title={BOT_SCOPES.find((s) => s.id === (page.botScope || DEFAULT_BOT_SCOPE))?.hint}>
                Used by
                <Select value={page.botScope || DEFAULT_BOT_SCOPE} onChange={(e) => onChange({ botScope: e.target.value })} className="h-8 w-auto text-xs">
                  {BOT_SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
              </label>
            </div>
            <button type="button" onClick={() => onChange({ deleted: true })} className="text-xs font-medium text-rose-300 hover:text-rose-200">Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}
