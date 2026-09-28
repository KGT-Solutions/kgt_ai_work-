import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, Logo, Select, Spinner, Textarea, cx } from '../components/ui';
import {
  IconAlert, IconArrowLeft, IconArrowRight, IconBuilding, IconCheck, IconChevronDown, IconDocs, IconGlobe, IconPencil, IconShield, IconSpark, IconUpload
} from '../components/ui/icons';
import { api, setToken } from '../lib/api';
import { DOC_CATEGORIES, DEFAULT_CATEGORY } from '../lib/documentCategories';
import { putSignupHandoff } from '../lib/signupHandoff';

// Self-serve signup for a new client company, in three steps:
//   1. Company & account — company, contact, email, password, industry
//   2. Knowledge         — scan the website AND/OR upload files / write entries,
//                          all reviewed together in three knowledge blocks
//   3. Review & launch   — creates the isolated tenant, its first (hashed)
//                          API key and the login in one request, then lands the
//                          company, signed in, on /dashboard.

const INDUSTRIES = [
  'SaaS & Technology', 'E-commerce & Retail', 'Healthcare & Pharma', 'Real Estate & Housing',
  'Fintech & Banking', 'Education', 'Professional Services', 'Other'
];
const CRAWL_STATUS = ['Crawling website pages…', 'Removing menus, footers and page noise…', 'Extracting FAQs, pricing and support content…', 'Structuring extracted content…'];
// Must match CRAWL_CONSENT_STATEMENT in apps/api/src/services/shared/crawlConsent.js.
const CRAWL_CONSENT_TEXT =
  'I am an authorized representative and legally permit the KGT Solutions AI crawler to access and extract content from this domain.';
const MAX_TRAINING_PAGES = 40; // mirrors MAX_PAGES_ON_COMPLETE in the API
const MAX_PDF_MB = 10;
const MAX_TEXT_KB = 200;
const MIN_PASSWORD_LEN = 10; // mirrors the API
const STEPS = ['Company & account', 'Knowledge', 'Review & launch'];

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const isTrainable = (p) => !p.deleted && p.title.trim() && p.content.trim();
const isPdf = (f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
const isText = (f) => /\.(txt|md|markdown)$/i.test(f.name) || /^text\/(plain|markdown)$/.test(f.type);

export default function Register() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [account, setAccount] = useState({ companyName: '', contactName: '', email: '', password: '', confirm: '', industryLabel: INDUSTRIES[0] });

  // One list for everything: crawled pages (url set), file sections (sourceFile) and written entries (manual).
  const [pages, setPages] = useState([]);
  const nextId = useRef(0);
  const withIds = (list) => list.map((p) => ({ category: DEFAULT_CATEGORY, ...p, id: nextId.current++, deleted: false }));

  const [websiteUrl, setWebsiteUrl] = useState('');
  const [consent, setConsent] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [crawl, setCrawl] = useState(null); // { crawled, skipped, baseHost, url }

  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');

  const trainable = pages.filter(isTrainable);
  const hasCrawled = trainable.some((p) => p.url);

  const scan = async () => {
    const url = websiteUrl.trim();
    if (!consent || !url || scanning) return;
    setScanError('');
    setScanning(true);
    try {
      const data = await api.analyzeCompanyUrl(url, { authorized: consent });
      // A re-scan replaces the previous scan's pages but keeps uploads and written entries.
      setPages((prev) => [...prev.filter((p) => !p.url), ...withIds(data.pages)]);
      setCrawl({ crawled: data.crawled, skipped: data.skipped, baseHost: data.baseHost, url });
    } catch (err) {
      setScanError(err.message);
    } finally {
      setScanning(false);
    }
  };

  const addPdfPages = (data, fileName, category) => {
    const added = withIds(data.pages.map((p) => ({ ...p, sourceFile: fileName, ...(category ? { category } : {}) })));
    setPages((prev) => [...prev, ...added]);
  };
  const addEntry = (category, { title = '', content = '', sourceFile } = {}) => {
    const [page] = withIds([{ title, content, url: null, category, manual: !sourceFile, sourceFile, autoExpand: true }]);
    setPages((prev) => [...prev, page]);
  };
  const updatePage = (id, patch) => setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const launch = async () => {
    if (launching) return;
    if (!trainable.length) return setLaunchError('Add at least one website page or document with a title and content.');
    if (trainable.length > MAX_TRAINING_PAGES) return setLaunchError(`You can train on up to ${MAX_TRAINING_PAGES} entries — remove ${trainable.length - MAX_TRAINING_PAGES}.`);
    setLaunchError('');
    setLaunching(true);
    try {
      const data = await api.completeRegistration({
        companyName: account.companyName.trim(),
        contactName: account.contactName.trim(),
        email: account.email.trim(),
        password: account.password,
        industryLabel: account.industryLabel,
        pages: trainable.map((p) => ({ title: p.title, content: p.content, category: p.category, sourceUrl: p.url || undefined })),
        // Required by the API whenever crawled pages are included; stored as the consent record.
        websiteConsent: hasCrawled ? { authorized: true, url: crawl?.url } : undefined
      });
      setToken('client', data.token);
      putSignupHandoff({ apiKey: data.apiKey, slug: data.slug, documentsCreated: data.documentsCreated });
      router.push('/dashboard');
    } catch (err) {
      setLaunchError(err.message);
      setLaunching(false);
    }
  };

  const goTo = (n) => {
    setStep(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-obsidian">
      <Head><title>Create your AI bots — KGT AI Hub</title></Head>
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[520px]" aria-hidden="true" />
      <div className="pointer-events-none absolute left-1/2 top-[-12rem] h-[26rem] w-[50rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-cyan-500/15 via-sky-500/10 to-violet-500/20 blur-3xl" aria-hidden="true" />

      <header className="relative mx-auto flex max-w-5xl items-center justify-between px-5 py-5">
        <Link href="/" aria-label="KGT AI Hub home"><Logo /></Link>
        <Link href="/login" className="text-sm text-fg-3 hover:text-fg-2">Already a customer? <span className="font-medium text-cyan-300">Sign in</span></Link>
      </header>

      <main className="relative mx-auto max-w-5xl px-5 pb-20 pt-4">
        <div className="mx-auto max-w-2xl text-center">
          <Badge tone="cyan"><IconShield className="h-3 w-3" />Private to your company</Badge>
          <h1 className="mt-4 text-balance text-3xl font-semibold tracking-tight text-fg sm:text-4xl">Create your Support & Sales bots</h1>
          <p className="mt-3 text-fg-2">Trained on your website and documents, live in three steps.</p>
        </div>

        <ol className="mx-auto mb-10 mt-10 grid max-w-2xl grid-cols-3 gap-3" aria-label="Progress">
          {STEPS.map((label, i) => (
            <li key={label} className="flex flex-col gap-2">
              <span className={cx('h-1 rounded-full transition-all duration-500', i <= step ? 'bg-gradient-to-r from-cyan-400 to-violet-400' : 'bg-white/10')} />
              <span className={cx('flex items-center gap-2 text-[13px] font-medium', i === step ? 'text-fg' : i < step ? 'text-fg-2' : 'text-fg-3')}>
                <span className={cx('flex h-5 w-5 items-center justify-center rounded-full text-[11px]', i < step ? 'bg-emerald-400/15 text-emerald-300' : i === step ? 'bg-cyan-400/15 text-cyan-200' : 'bg-white/5')}>
                  {i < step ? <IconCheck className="h-3 w-3" /> : i + 1}
                </span>
                <span className="truncate">{label}</span>
              </span>
            </li>
          ))}
        </ol>

        <div key={step} className="animate-fade-up">
          {step === 0 && <StepAccount account={account} setAccount={setAccount} onNext={() => goTo(1)} />}
          {step === 1 && (
            <StepKnowledge
              websiteUrl={websiteUrl} setWebsiteUrl={setWebsiteUrl} consent={consent} setConsent={setConsent}
              scanning={scanning} scanError={scanError} crawl={crawl} onScan={scan}
              pages={pages} trainableCount={trainable.length} updatePage={updatePage} addPdfPages={addPdfPages} addEntry={addEntry}
              onBack={() => goTo(0)} onNext={() => goTo(2)}
            />
          )}
          {step === 2 && (
            <StepReview account={account} trainable={trainable} crawledHost={hasCrawled ? crawl?.baseHost : null}
              launching={launching} launchError={launchError} onBack={() => goTo(1)} onLaunch={launch} />
          )}
        </div>
      </main>
    </div>
  );
}

// ── Step 1
function StepAccount({ account, setAccount, onNext }) {
  const [touched, setTouched] = useState({});
  const set = (k) => (e) => setAccount((a) => ({ ...a, [k]: e.target.value }));
  const touch = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const problems = {
    companyName: !account.companyName.trim() ? 'Enter your company name.' : '',
    email: !isValidEmail(account.email) ? 'Enter a valid email address.' : '',
    password: account.password.length < MIN_PASSWORD_LEN ? `Use at least ${MIN_PASSWORD_LEN} characters.` : '',
    confirm: account.confirm !== account.password ? "Passwords don't match." : ''
  };
  const valid = !Object.values(problems).some(Boolean);
  const err = (k) => (touched[k] ? problems[k] : '');

  return (
    <form noValidate className="mx-auto max-w-2xl" onSubmit={(e) => {
      e.preventDefault();
      setTouched({ companyName: true, email: true, password: true, confirm: true });
      if (valid) onNext();
    }}>
      <Card>
        <CardHeader icon={<IconBuilding className="h-4 w-4" />} title="Company & account"
          description="Your sign-in for the dashboard where you manage and test your bots. Nothing is created until the last step." />
        <div className="grid gap-5 p-6 sm:grid-cols-2">
          <Field label="Company name" htmlFor="r-company" error={err('companyName')} className="sm:col-span-2">
            <Input id="r-company" value={account.companyName} onChange={set('companyName')} onBlur={touch('companyName')} invalid={!!err('companyName')} placeholder="Acme Corporation" autoComplete="organization" />
          </Field>
          <Field label="Your name" htmlFor="r-name" hint="Optional">
            <Input id="r-name" value={account.contactName} onChange={set('contactName')} placeholder="Priya Sharma" autoComplete="name" />
          </Field>
          <Field label="Industry" htmlFor="r-industry">
            <Select id="r-industry" value={account.industryLabel} onChange={set('industryLabel')}>
              {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
            </Select>
          </Field>
          <Field label="Work email" htmlFor="r-email" error={err('email')} hint="You'll sign in with this." className="sm:col-span-2">
            <Input id="r-email" type="email" value={account.email} onChange={set('email')} onBlur={touch('email')} invalid={!!err('email')} placeholder="you@company.com" autoComplete="email" />
          </Field>
          <Field label="Password" htmlFor="r-password" error={err('password')} hint={`At least ${MIN_PASSWORD_LEN} characters.`}>
            <Input id="r-password" type="password" value={account.password} onChange={set('password')} onBlur={touch('password')} invalid={!!err('password')} autoComplete="new-password" />
          </Field>
          <Field label="Confirm password" htmlFor="r-confirm" error={err('confirm')}>
            <Input id="r-confirm" type="password" value={account.confirm} onChange={set('confirm')} onBlur={touch('confirm')} invalid={!!err('confirm')} autoComplete="new-password" />
          </Field>
        </div>
        <div className="flex justify-end border-t border-white/[0.06] px-6 py-4">
          <Button type="submit" variant="primary">Continue <IconArrowRight className="h-4 w-4" /></Button>
        </div>
      </Card>
    </form>
  );
}

// ── Step 2
function StepKnowledge({ websiteUrl, setWebsiteUrl, consent, setConsent, scanning, scanError, crawl, onScan,
  pages, trainableCount, updatePage, addPdfPages, addEntry, onBack, onNext }) {
  const [statusIndex, setStatusIndex] = useState(0);
  useEffect(() => {
    if (!scanning) return undefined;
    setStatusIndex(0);
    const id = setInterval(() => setStatusIndex((i) => Math.min(i + 1, CRAWL_STATUS.length - 1)), 2200);
    return () => clearInterval(id);
  }, [scanning]);
  const canScan = consent && websiteUrl.trim() && !scanning;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader icon={<IconGlobe className="h-4 w-4" />} title="Scan your website" description="Optional. Up to 12 public pages — About, FAQ, Support, Pricing and pages linked from them." />
        <form className="space-y-4 p-6" onSubmit={(e) => { e.preventDefault(); if (canScan) onScan(); }} noValidate>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <IconGlobe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
              <Input type="url" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://mycompany.com" className="pl-9" disabled={scanning} aria-label="Website URL" />
            </div>
            <Button type="submit" variant="primary" disabled={!canScan} loading={scanning}>{scanning ? 'Scanning…' : crawl ? 'Scan again' : <><IconSpark className="h-4 w-4" />Scan website</>}</Button>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
            <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={scanning}>{CRAWL_CONSENT_TEXT}</Checkbox>
          </div>
          {scanning && <p className="flex items-center gap-2 text-sm text-cyan-200" aria-live="polite"><Spinner className="h-4 w-4" />{CRAWL_STATUS[statusIndex]}</p>}
          {!scanning && scanError && (
            <p className="flex items-start gap-2 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-100" role="alert">
              <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />{scanError} JavaScript-only or protected sites often can&apos;t be scanned — upload documents below instead.
            </p>
          )}
          {!scanning && !scanError && crawl && (
            <p className="flex items-center gap-2 text-sm text-emerald-200" aria-live="polite"><IconCheck className="h-4 w-4" />
              Added {crawl.crawled} page{crawl.crawled === 1 ? '' : 's'} from {crawl.baseHost}{crawl.skipped ? ` (skipped ${crawl.skipped} thin pages)` : ''} — review them below.
            </p>
          )}
        </form>
      </Card>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg">Your knowledge</h2>
          <p className="text-sm text-fg-3">Upload PDFs, .txt or .md files, or write entries. Scanned pages land here too — move or edit anything before launch.</p>
        </div>
        <Badge tone={trainableCount > MAX_TRAINING_PAGES ? 'warning' : 'cyan'}>{trainableCount} / {MAX_TRAINING_PAGES} entries</Badge>
      </div>

      <div className="space-y-4">
        {DOC_CATEGORIES.map((c) => (
          <KnowledgeBlock key={c.id} category={c} pages={pages.filter((p) => p.category === c.id)} updatePage={updatePage}
            onPdfPages={(data, name) => addPdfPages(data, name, c.id)} onEntry={(prefill) => addEntry(c.id, prefill)} />
        ))}
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button onClick={onBack} disabled={scanning}><IconArrowLeft className="h-4 w-4" />Back</Button>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <Button variant="primary" onClick={onNext} disabled={scanning || trainableCount === 0}>Review & launch <IconArrowRight className="h-4 w-4" /></Button>
          {trainableCount === 0 && <span className="text-xs text-fg-3">Scan your website or add at least one document.</span>}
        </div>
      </div>
    </div>
  );
}

function KnowledgeBlock({ category, pages, updatePage, onPdfPages, onEntry }) {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState('');
  const [results, setResults] = useState([]);
  const inputRef = useRef(null);
  const live = pages.filter((p) => !p.deleted).length;

  const handleFiles = async (list) => {
    const files = Array.from(list || []);
    if (!files.length || busy) return;
    const out = [];
    for (const f of files) {
      setBusy(f.name);
      try {
        if (isPdf(f)) {
          if (f.size > MAX_PDF_MB * 1024 * 1024) throw new Error(`larger than ${MAX_PDF_MB}MB`);
          const data = await api.analyzeCompanyPdf(f);
          onPdfPages(data, f.name);
          out.push({ ok: true, text: `${f.name}: ${data.pages.length} section${data.pages.length === 1 ? '' : 's'}${data.truncated ? ' (first part only)' : ''}` });
        } else if (isText(f)) {
          if (f.size > MAX_TEXT_KB * 1024) throw new Error(`text files are limited to ${MAX_TEXT_KB}KB`);
          const content = (await f.text()).trim();
          if (!content) throw new Error('the file is empty');
          onEntry({ title: f.name.replace(/\.(txt|md|markdown)$/i, ''), content, sourceFile: f.name });
          out.push({ ok: true, text: `${f.name}: added as an editable entry` });
        } else {
          throw new Error('use a PDF, .txt or .md file');
        }
      } catch (err) {
        out.push({ ok: false, text: `${f.name}: ${err.message}` });
      }
    }
    setBusy('');
    setResults(out);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <Card>
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-fg">{category.label}</h3>
            <Badge>{live}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-[13px] text-fg-3">{category.hint}</p>
        </div>
      </div>
      <div className="space-y-2 border-t border-white/[0.06] p-5">
        {pages.map((p) => <EntryRow key={p.id} page={p} onChange={(patch) => updatePage(p.id, patch)} />)}
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <label onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
            className={cx('relative flex cursor-pointer items-center gap-3 rounded-xl border border-dashed px-4 py-3 transition focus-within:ring-4 focus-within:ring-cyan-400/10',
              drag ? 'border-cyan-400/70 bg-cyan-400/[0.06]' : 'border-white/15 hover:border-white/25 hover:bg-white/[0.02]')}>
            <input ref={inputRef} type="file" multiple accept="application/pdf,.pdf,.txt,.md,.markdown,text/plain,text/markdown"
              className="absolute h-px w-px opacity-0" disabled={!!busy} onChange={(e) => handleFiles(e.target.files)} />
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-cyan-300">
              {busy ? <Spinner className="h-4 w-4" /> : <IconUpload className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-fg">{busy ? `Reading ${busy}…` : `Upload files to ${category.short}`}</span>
              <span className="block text-xs text-fg-3">Drop or click · PDF up to {MAX_PDF_MB}MB, .txt / .md</span>
            </span>
          </label>
          <Button onClick={() => onEntry()} className="h-auto py-3"><IconPencil className="h-4 w-4" />Write an entry</Button>
        </div>
        {results.length > 0 && (
          <ul className="space-y-0.5 pt-1" aria-live="polite">
            {results.map((r, i) => <li key={i} className={cx('text-xs', r.ok ? 'text-emerald-300' : 'text-rose-300')}>{r.text}</li>)}
          </ul>
        )}
      </div>
    </Card>
  );
}

function EntryRow({ page, onChange }) {
  const [open, setOpen] = useState(!!page.autoExpand);
  if (page.deleted) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-dashed border-white/10 px-3 py-2">
        <span className="truncate text-[13px] text-fg-3 line-through">{page.title || 'Untitled entry'}</span>
        <button type="button" onClick={() => onChange({ deleted: false })} className="text-xs font-medium text-cyan-300">Undo</button>
      </div>
    );
  }
  const Icon = page.url ? IconGlobe : page.sourceFile ? IconDocs : IconPencil;
  const source = page.url || (page.sourceFile ? `${/\.pdf$/i.test(page.sourceFile) ? 'PDF' : 'File'} · ${page.sourceFile}` : 'Written by you');

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <Icon className="h-4 w-4 shrink-0 text-fg-3" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-fg">{page.title || 'Untitled entry'}</span>
          <span className="block truncate text-[11.5px] text-fg-3">{source}</span>
        </span>
        <IconChevronDown className={cx('h-4 w-4 shrink-0 text-fg-3 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/[0.06] p-3">
          <Input value={page.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="Title, e.g. Shipping & returns" aria-label="Entry title" />
          <Textarea value={page.content} onChange={(e) => onChange({ content: e.target.value })} className="font-mono text-[12.5px]" aria-label="Entry content"
            placeholder={'## A question or topic\nThe answer, in plain words.\n\n## Another topic\n…'} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-fg-3">
              Move to
              <Select value={page.category} onChange={(e) => onChange({ category: e.target.value })} className="h-8 w-auto text-xs">
                {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.short}</option>)}
              </Select>
            </label>
            <button type="button" onClick={() => onChange({ deleted: true })} className="text-xs font-medium text-rose-300 hover:text-rose-200">Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 3
function StepReview({ account, trainable, crawledHost, launching, launchError, onBack, onLaunch }) {
  const fromWebsite = trainable.filter((p) => p.url).length;
  const fromFiles = trainable.length - fromWebsite;
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader icon={<IconSpark className="h-4 w-4" />} title="Ready to launch"
          description="Creates your private workspace, your first API key and your login, then signs you in to your dashboard." />
        <dl className="grid gap-x-6 gap-y-4 p-6 sm:grid-cols-2">
          {[['Company', account.companyName], ['Industry', account.industryLabel], ['Sign-in email', account.email],
            ['Knowledge', [fromWebsite && `${fromWebsite} from ${crawledHost || 'your website'}`, fromFiles && `${fromFiles} from documents`].filter(Boolean).join(' · ')]]
            .map(([k, v]) => (
              <div key={k} className="min-w-0"><dt className="text-xs text-fg-3">{k}</dt><dd className="mt-0.5 truncate text-sm font-medium text-fg">{v}</dd></div>
            ))}
        </dl>
        <div className="grid grid-cols-3 gap-3 border-t border-white/[0.06] p-6">
          {DOC_CATEGORIES.map((c) => (
            <div key={c.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-3 text-center">
              <p className="text-2xl font-semibold tabular-nums text-fg">{trainable.filter((p) => p.category === c.id).length}</p>
              <p className="truncate text-xs text-fg-3">{c.short}</p>
            </div>
          ))}
        </div>
        {launchError && (
          <p className="mx-6 mb-4 rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-100" role="alert">
            {launchError} {/already exists/i.test(launchError) && <Link href="/login" className="font-medium underline">Sign in</Link>}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 border-t border-white/[0.06] px-6 py-4 sm:flex-row sm:justify-between">
          <Button onClick={onBack} disabled={launching}><IconArrowLeft className="h-4 w-4" />Back</Button>
          <Button variant="primary" onClick={onLaunch} loading={launching} disabled={!trainable.length}>
            {launching ? `Training on ${trainable.length} entries…` : <><IconSpark className="h-4 w-4" />Create my bots</>}
          </Button>
        </div>
      </Card>
    </div>
  );
}
