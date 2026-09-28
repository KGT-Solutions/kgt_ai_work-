import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { api, setToken } from '../lib/api';
import { putSignupHandoff } from '../lib/signupHandoff';
// The API suggests a category for every crawled/uploaded page (which block it
// starts in); the visitor can move anything between blocks before training.
import { DOC_CATEGORIES, DEFAULT_CATEGORY } from '../lib/documentCategories';

// Self-serve signup for a new client company, in three steps:
//   1. Company & account  — company, contact, email, password, industry
//   2. Knowledge          — scan the website AND/OR upload files / write entries,
//                           all reviewed together in three knowledge blocks
//   3. Review & launch    — creates the isolated tenant, its first (hashed)
//                           API key and the client login in one request, then
//                           lands the company on its own /dashboard, signed in.

const INDUSTRIES = [
  'SaaS & Technology', 'E-commerce & Retail', 'Healthcare & Pharma', 'Real Estate & Housing',
  'Fintech & Banking', 'Education', 'Professional Services', 'Other'
];

const CRAWL_STATUS_MESSAGES = [
  'Crawling website pages…',
  'Removing navigation, footers, and other page noise…',
  'Extracting FAQs, pricing, and support content…',
  'Structuring extracted content…'
];

const CRAWLER_PERMISSION_TEXT =
  'Please allow the AI crawler to go deep into your website pages to scrape and index all necessary ' +
  'content so your support and sales bots get trained with absolute precision.';

// Must match CRAWL_CONSENT_STATEMENT in apps/api/src/services/shared/crawlConsent.js,
// which is the copy stored in each tenant's consent record.
const CRAWL_CONSENT_TEXT =
  'I am an authorized representative and legally permit the KGT Solutions AI crawler to access and ' +
  'extract content from this domain.';

// Mirrors MAX_PAGES_ON_COMPLETE in apps/api/src/routes/publicRegister.routes.js
// — the server drops anything past it, so stop the visitor here.
const MAX_TRAINING_PAGES = 40;
const MAX_PDF_MB = 10;
const MIN_PASSWORD_LEN = 10; // mirrors the API

const STEPS = [
  { label: 'Company & account', sub: 'Who you are, how you sign in' },
  { label: 'Knowledge', sub: 'Website and/or documents' },
  { label: 'Review & launch', sub: 'Create your bots' }
];

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const isTrainable = (p) => !p.deleted && p.title.trim() && p.content.trim();

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);

  // Step 1
  const [account, setAccount] = useState({
    companyName: '', contactName: '', email: '', password: '', confirm: '', industryLabel: INDUSTRIES[0]
  });

  // Step 2 — one list for everything: crawled pages (url set), PDF sections
  // (sourceFile set) and hand-written entries (manual).
  const [pages, setPages] = useState([]);
  // ids must stay unique across repeated crawls and uploads (array indexes would collide).
  const nextPageId = useRef(0);
  const withIds = (list) =>
    list.map((p) => ({ category: DEFAULT_CATEGORY, ...p, id: nextPageId.current++, deleted: false }));

  // Website scan (optional)
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [crawlConsent, setCrawlConsent] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const [crawlStats, setCrawlStats] = useState(null);
  // The URL the kept crawled pages came from — recorded with the consent at signup.
  const [crawledUrl, setCrawledUrl] = useState('');

  // Step 3
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');

  const trainablePages = pages.filter(isTrainable);
  const hasCrawledPages = trainablePages.some((p) => p.url);

  const scanWebsite = async () => {
    const url = websiteUrl.trim();
    if (!crawlConsent || !url || scanning) return;
    setScanError('');
    setScanning(true);
    try {
      const data = await api.analyzeCompanyUrl(url, { authorized: crawlConsent });
      // A re-scan replaces the previous scan's pages but keeps uploads and written entries.
      setPages((prev) => [...prev.filter((p) => !p.url), ...withIds(data.pages)]);
      setCrawlStats({ crawled: data.crawled, skipped: data.skipped, baseHost: data.baseHost });
      setCrawledUrl(url);
    } catch (err) {
      setScanError(err.message);
    } finally {
      setScanning(false);
    }
  };

  // category: the block the file was dropped into — the visitor's choice beats the API's suggestion.
  const addPdfPages = (data, fileName, category) => {
    const added = withIds(data.pages.map((p) => ({ ...p, sourceFile: fileName, ...(category ? { category } : {}) })));
    if (added.length) added[0].autoExpand = true; // "instant preview": open the first parsed part in the editor
    setPages((prev) => [...prev, ...added]);
    return added[0]?.category;
  };

  // A blank entry to write in, or (from a .txt/.md upload) one pre-filled with the file's text.
  const addTextPage = (category, { title = '', content = '', sourceFile } = {}) => {
    const [page] = withIds([{ title, content, url: null, category, manual: !sourceFile, sourceFile, autoExpand: true }]);
    setPages((prev) => [...prev, page]);
  };

  const launch = async () => {
    if (launching) return;
    if (!trainablePages.length) {
      setLaunchError('Add at least one website page or document with a title and content.');
      return;
    }
    if (trainablePages.length > MAX_TRAINING_PAGES) {
      setLaunchError(`You can train on up to ${MAX_TRAINING_PAGES} entries — remove ${trainablePages.length - MAX_TRAINING_PAGES} to continue.`);
      return;
    }
    setLaunchError('');
    setLaunching(true);
    try {
      const data = await api.completeRegistration({
        companyName: account.companyName.trim(),
        contactName: account.contactName.trim(),
        email: account.email.trim(),
        password: account.password,
        industryLabel: account.industryLabel,
        pages: trainablePages.map((p) => ({ title: p.title, content: p.content, category: p.category, sourceUrl: p.url || undefined })),
        // Required by the API whenever crawled pages are included; stored as the consent record.
        websiteConsent: hasCrawledPages ? { authorized: true, url: crawledUrl } : undefined
      });
      setToken('client', data.token);
      putSignupHandoff({ apiKey: data.apiKey, slug: data.slug, documentsCreated: data.documentsCreated });
      router.push('/dashboard');
    } catch (err) {
      setLaunchError(err.status === 409 ? `${err.message}` : err.message);
      setLaunching(false);
    }
  };

  const goTo = (n) => {
    setStep(n);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <Head>
        <title>Create your AI bots — KGT Solutions AI Hub</title>
      </Head>
      {/* Tailwind Preflight is disabled app-wide (see tailwind.config.js), so this
          page carries its own zero-specificity resets, scoped to its root. */}
      <style jsx global>{`
        :where(.kgt-onboard) *, :where(.kgt-onboard) ::before, :where(.kgt-onboard) ::after {
          box-sizing: border-box; border: 0 solid #e2e8f0;
        }
        :where(.kgt-onboard) :is(h1, h2, h3, h4, p, ul, ol, pre, figure) { margin: 0; padding: 0; }
        :where(.kgt-onboard) :is(ul, ol) { list-style: none; }
        :where(.kgt-onboard) :is(button, input, select, textarea) {
          font: inherit; color: inherit; margin: 0; background-color: transparent;
        }
        :where(.kgt-onboard) :is(button, [role='button']) { cursor: pointer; }
        :where(.kgt-onboard) :disabled { cursor: not-allowed; }
        @keyframes kgtFadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .kgt-fade-up { animation: kgtFadeUp 0.35s ease-out both; }
        @media (prefers-reduced-motion: reduce) { .kgt-fade-up { animation: none; } }
      `}</style>

      <div
        className="kgt-onboard min-h-screen bg-slate-50 text-slate-900 antialiased"
        style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' }}
      >
        <TopBar />
        <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
          <PageHeader />
          <StepIndicator step={step} />

          <div key={step} className="kgt-fade-up">
            {step === 1 && <Step1Account account={account} setAccount={setAccount} onNext={() => goTo(2)} />}

            {step === 2 && (
              <Step2Knowledge
                websiteUrl={websiteUrl} setWebsiteUrl={setWebsiteUrl}
                crawlConsent={crawlConsent} setCrawlConsent={setCrawlConsent}
                scanning={scanning} scanError={scanError} crawlStats={crawlStats}
                onScan={scanWebsite}
                pages={pages} setPages={setPages}
                trainableCount={trainablePages.length}
                onPdfPages={addPdfPages} onAddText={addTextPage}
                onBack={() => goTo(1)}
                onNext={() => goTo(3)}
              />
            )}

            {step === 3 && (
              <Step3Review
                account={account}
                trainablePages={trainablePages}
                crawledHost={hasCrawledPages ? crawlStats?.baseHost : null}
                launching={launching} launchError={launchError}
                onBack={() => goTo(2)}
                onLaunch={launch}
              />
            )}
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------
// Chrome

function TopBar() {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-sm font-bold text-white shadow-sm shadow-indigo-600/30">
            K
          </div>
          <div>
            <div className="text-sm font-bold leading-tight text-slate-900">KGT Solutions</div>
            <div className="text-xs leading-tight text-slate-500">AI Hub</div>
          </div>
        </div>
        <a href="/login" className="text-sm font-medium text-slate-500 no-underline transition hover:text-slate-900">
          Already a customer? <span className="font-semibold text-indigo-600">Sign in</span>
        </a>
      </div>
    </header>
  );
}

function PageHeader() {
  return (
    <div className="text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
        <LockIcon className="h-3.5 w-3.5" /> Tenant-isolated · Your data trains only your bots
      </span>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
        KGT Solutions AI Hub <span className="text-slate-400">—</span>{' '}
        <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">Create your AI bots</span>
      </h1>
      <p className="mx-auto mt-3 max-w-2xl text-base text-slate-600">
        Launch a grounded Support Bot and a conversion-focused Sales Bot, trained on your website and documents, live in three steps.
      </p>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-400">
      © {new Date().getFullYear()} KGT Solutions. Your data trains only your own bots — nothing is shared across companies.
    </footer>
  );
}

function StepIndicator({ step }) {
  return (
    <ol className="mx-auto my-10 grid max-w-3xl grid-cols-3 gap-3">
      {STEPS.map((s, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'active' : 'upcoming';
        return (
          <li key={s.label} className="flex flex-col gap-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className={
                  'h-full rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 transition-all duration-500 ' +
                  (state === 'upcoming' ? 'w-0' : 'w-full')
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <span
                className={
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition ' +
                  (state === 'done'
                    ? 'bg-emerald-500 text-white'
                    : state === 'active'
                      ? 'bg-indigo-600 text-white ring-4 ring-indigo-100'
                      : 'bg-slate-200 text-slate-500')
                }
              >
                {state === 'done' ? <CheckIcon className="h-3.5 w-3.5" /> : n}
              </span>
              <div className="min-w-0">
                <div className={'truncate text-sm font-semibold ' + (state === 'upcoming' ? 'text-slate-400' : 'text-slate-900')}>
                  {s.label}
                </div>
                <div className="hidden truncate text-xs text-slate-500 sm:block">{s.sub}</div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------
// Step 1 — Company & account

function Step1Account({ account, setAccount, onNext }) {
  const [touched, setTouched] = useState({});
  const set = (field) => (e) => setAccount((a) => ({ ...a, [field]: e.target.value }));
  const touch = (field) => () => setTouched((t) => ({ ...t, [field]: true }));

  const problems = {
    companyName: !account.companyName.trim() ? 'Enter your company name.' : '',
    email: !isValidEmail(account.email) ? 'Enter a valid email address.' : '',
    password: account.password.length < MIN_PASSWORD_LEN ? `Use at least ${MIN_PASSWORD_LEN} characters.` : '',
    confirm: account.confirm !== account.password ? "Passwords don't match." : ''
  };
  const valid = !Object.values(problems).some(Boolean);
  const show = (field) => (touched[field] ? problems[field] : '');
  const bad = (field) => (show(field) ? ' border-red-400 focus:border-red-500 focus:ring-red-500/20' : '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched({ companyName: true, email: true, password: true, confirm: true });
        if (valid) onNext();
      }}
      className="mx-auto max-w-2xl"
      noValidate
    >
      <Card>
        <CardHeader
          icon={<BuildingIcon className="h-5 w-5" />}
          title="Company & account"
          subtitle="Your sign-in for the dashboard where you manage and test your bots. Nothing is created until the last step."
        />
        <div className="grid gap-5 p-6 sm:grid-cols-2 sm:p-8">
          <Field label="Company name" className="sm:col-span-2" error={show('companyName')}>
            <input className={inputClass + bad('companyName')} value={account.companyName} onChange={set('companyName')} onBlur={touch('companyName')}
              placeholder="Acme Corporation" autoComplete="organization" />
          </Field>
          <Field label="Your name" hint="Optional">
            <input className={inputClass} value={account.contactName} onChange={set('contactName')} placeholder="Priya Sharma" autoComplete="name" />
          </Field>
          <Field label="Industry">
            <div className="relative">
              <select className={inputClass + ' appearance-none pr-10'} value={account.industryLabel} onChange={set('industryLabel')}>
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </Field>
          <Field label="Business email" className="sm:col-span-2" error={show('email')} hint="You'll sign in with this.">
            <input type="email" className={inputClass + bad('email')} value={account.email} onChange={set('email')} onBlur={touch('email')}
              placeholder="you@company.com" autoComplete="email" />
          </Field>
          <Field label="Password" error={show('password')} hint={`At least ${MIN_PASSWORD_LEN} characters.`}>
            <input type="password" className={inputClass + bad('password')} value={account.password} onChange={set('password')} onBlur={touch('password')}
              autoComplete="new-password" />
          </Field>
          <Field label="Confirm password" error={show('confirm')}>
            <input type="password" className={inputClass + bad('confirm')} value={account.confirm} onChange={set('confirm')} onBlur={touch('confirm')}
              autoComplete="new-password" />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:px-8">
          <p className="hidden text-xs text-slate-500 sm:block">
            Already have an account? <a href="/login" className="font-semibold text-indigo-600">Sign in</a>
          </p>
          <button type="submit" className={primaryBtnClass}>
            Continue <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>
      </Card>
    </form>
  );
}

// ---------------------------------------------------------------------
// Step 2 — Knowledge: website scan and/or documents, reviewed together

function Step2Knowledge({
  websiteUrl, setWebsiteUrl, crawlConsent, setCrawlConsent, scanning, scanError, crawlStats, onScan,
  pages, setPages, trainableCount, onPdfPages, onAddText, onBack, onNext
}) {
  const updatePage = (id, patch) => setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  return (
    <div className="mx-auto max-w-4xl">
      <TrainingTip />

      <div className="mt-10 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">Step 2 of 3 · Knowledge</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">Teach your bots</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
          Scan your website, upload documents, or both. Everything lands in the three blocks below, where you can
          review, move and edit it before launch.
        </p>
      </div>

      <div className="mt-8">
        <WebsiteImportCard
          websiteUrl={websiteUrl} setWebsiteUrl={setWebsiteUrl}
          crawlConsent={crawlConsent} setCrawlConsent={setCrawlConsent}
          scanning={scanning} scanError={scanError} crawlStats={crawlStats}
          onScan={onScan}
        />
      </div>

      <div className="mt-8 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">Your knowledge blocks</h3>
            <p className="text-sm text-slate-500">
              Upload PDFs, .txt or .md files, or write entries. Scanned website pages appear here too.
            </p>
          </div>
          <CountPill count={trainableCount} />
        </div>
        {DOC_CATEGORIES.map((c, i) => (
          <KnowledgeBlock
            key={c.id}
            index={i + 1}
            category={c}
            pages={pages.filter((p) => p.category === c.id)}
            updatePage={updatePage}
            onPdfPages={(data, fileName) => onPdfPages(data, fileName, c.id)}
            onAddText={(prefill) => onAddText(c.id, prefill)}
          />
        ))}
      </div>

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onBack} disabled={scanning} className={secondaryBtnClass}>
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </button>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <button type="button" onClick={onNext} disabled={scanning || trainableCount === 0} className={primaryBtnClass}>
            Review & launch <ArrowRightIcon className="h-4 w-4" />
          </button>
          {trainableCount === 0 && !scanning && (
            <span className="text-center text-xs text-slate-500 sm:text-right">Scan your website or add at least one document.</span>
          )}
          {trainableCount > MAX_TRAINING_PAGES && (
            <span className="text-center text-xs font-medium text-amber-700 sm:text-right">
              Over the {MAX_TRAINING_PAGES}-entry limit — remove {trainableCount - MAX_TRAINING_PAGES} before launch.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// Optional website scan. Crawled pages are added to the knowledge blocks for
// review; nothing is trained until launch. Scanning requires the visitor's
// authorization (enforced by the API too), and it's recorded at launch.
function WebsiteImportCard({ websiteUrl, setWebsiteUrl, crawlConsent, setCrawlConsent, scanning, scanError, crawlStats, onScan }) {
  const [statusIndex, setStatusIndex] = useState(0);
  useEffect(() => {
    if (!scanning) return undefined;
    setStatusIndex(0);
    const id = setInterval(() => setStatusIndex((i) => Math.min(i + 1, CRAWL_STATUS_MESSAGES.length - 1)), 2200);
    return () => clearInterval(id);
  }, [scanning]);

  const canScan = crawlConsent && websiteUrl.trim() && !scanning;

  return (
    <Card>
      <CardHeader
        icon={<GlobeIcon className="h-5 w-5" />}
        title="Scan your website (optional)"
        subtitle="Up to 12 public pages — About, FAQ, Support, Pricing and pages linked from them."
      />
      <form onSubmit={(e) => { e.preventDefault(); if (canScan) onScan(); }} className="space-y-4 p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"><GlobeIcon className="h-4 w-4" /></span>
            <input type="url" inputMode="url" aria-label="Website URL" className={inputClass + ' py-3 pl-10 disabled:bg-slate-100'}
              value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://mycompany.com" disabled={scanning} />
          </div>
          <button type="submit" disabled={!canScan} className={primaryBtnClass + ' shrink-0'}>
            {scanning ? <Spinner /> : <SparkIcon className="h-4 w-4" />}
            {scanning ? 'Scanning…' : crawlStats ? 'Scan again' : 'Scan website'}
          </button>
        </div>

        <div className="flex gap-3 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm"><ShieldIcon className="h-5 w-5" /></span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-indigo-900">Crawler permission &amp; security</p>
            <p className="mt-1 text-sm leading-relaxed text-indigo-900/80">{CRAWLER_PERMISSION_TEXT}</p>
          </div>
        </div>

        <label className={'flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition ' +
          (crawlConsent ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white hover:border-slate-300')}>
          <input type="checkbox" checked={crawlConsent} onChange={(e) => setCrawlConsent(e.target.checked)} disabled={scanning}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-indigo-600" />
          <span className="text-sm leading-relaxed text-slate-700">{CRAWL_CONSENT_TEXT} <span className="font-semibold text-red-600">*</span></span>
        </label>

        {scanning && (
          <div className="kgt-fade-up rounded-xl border border-indigo-100 bg-indigo-50/60 p-4" aria-live="polite">
            <div className="flex items-center gap-3">
              <Spinner className="h-5 w-5 text-indigo-600" />
              <p className="text-sm font-semibold text-indigo-900">{CRAWL_STATUS_MESSAGES[statusIndex]}</p>
            </div>
            <p className="mt-2 text-xs text-indigo-700/80">Usually under a minute. Please keep this tab open.</p>
          </div>
        )}
        {!scanning && scanError && (
          <div className="kgt-fade-up rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
            <p className="text-sm font-semibold text-red-800">We couldn't scan that site</p>
            <p className="mt-1 text-sm text-red-700">{scanError}</p>
            <p className="mt-2 text-sm text-red-800">JavaScript-heavy or protected sites often can't be scanned — upload documents below instead.</p>
          </div>
        )}
        {!scanning && !scanError && crawlStats && (
          <p className="kgt-fade-up text-sm text-emerald-700" aria-live="polite">
            Added {crawlStats.crawled} page{crawlStats.crawled === 1 ? '' : 's'} from {crawlStats.baseHost} to your knowledge blocks
            {crawlStats.skipped ? ` (skipped ${crawlStats.skipped} with too little text)` : ''}. Review them below.
          </p>
        )}
        {!scanning && !canScan && !crawlStats && (
          <p className="text-xs text-slate-500">
            {!websiteUrl.trim() ? 'Enter your website address' : 'Tick the authorization box'} to scan — or skip this and upload documents below.
          </p>
        )}
      </form>
    </Card>
  );
}

function TrainingTip() {
  return (
    <aside
      role="note"
      className="flex items-start gap-3.5 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-indigo-50/60 p-4 shadow-sm sm:p-5"
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-lg shadow-sm ring-1 ring-sky-100"
      >
        💡
      </span>
      <p className="text-sm leading-relaxed text-slate-700">
        <strong className="font-semibold text-slate-900">A quick tip on training your AI:</strong> Web scraping is a great way
        to get a quick 60% head-start on public marketing pages. For absolute precision and complete control, uploading
        structured documents (like official FAQs, care guides, or product sheets) is our recommended professional
        choice—giving your bots 100% accuracy on day one.
      </p>
    </aside>
  );
}

function CountPill({ count }) {
  const over = count > MAX_TRAINING_PAGES;
  return (
    <span className={'rounded-full px-3 py-1 text-xs font-semibold ' + (over ? 'bg-amber-100 text-amber-800' : 'bg-slate-900 text-white')}>
      {count} / {MAX_TRAINING_PAGES} entries ready
    </span>
  );
}

const BLOCK_ICONS = {
  CORE_OVERVIEW: BuildingIcon,
  FAQ: ChatIcon,
  CUSTOM_POLICY: ScaleIcon
};

// Headings follow the onboarding copy; ids and hints still come from the
// shared taxonomy in lib/documentCategories.js.
const BLOCK_TITLES = {
  CORE_OVERVIEW: 'Core Company Overview & Background',
  FAQ: 'Frequently Asked Questions (FAQs)',
  CUSTOM_POLICY: 'Custom Policies, Pricing & Product Manuals'
};

function KnowledgeBlock({ index, category, pages, updatePage, onPdfPages, onAddText }) {
  const Icon = BLOCK_ICONS[category.id] || DocumentIcon;
  const liveCount = pages.filter((p) => !p.deleted).length;

  return (
    <Card>
      <div className="flex items-start gap-4 p-5 sm:p-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Block {index}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {liveCount} item{liveCount === 1 ? '' : 's'}
            </span>
          </div>
          <h4 className="mt-0.5 text-base font-bold text-slate-900">{BLOCK_TITLES[category.id] || category.label}</h4>
          <p className="mt-1 text-sm text-slate-500">{category.hint}</p>
        </div>
      </div>

      <div className="space-y-2.5 border-t border-slate-100 bg-slate-50/60 p-5 sm:p-6">
        {pages.map((p) => (
          <PageRow key={p.id} page={p} onChange={(patch) => updatePage(p.id, patch)} />
        ))}
        <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
          <FileUploadCard onPdfPages={onPdfPages} onTextFile={onAddText} title={`Upload files to ${category.short}`} />
          <button
            type="button"
            onClick={() => onAddText()}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-5 py-4 text-sm font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700"
          >
            <PencilIcon className="h-4 w-4" /> Paste or write text
          </button>
        </div>
      </div>
    </Card>
  );
}

const MAX_TEXT_FILE_KB = 200;
const isPdf = (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
const isTextFile = (file) => /\.(txt|md|markdown)$/i.test(file.name) || /^text\/(plain|markdown)$/.test(file.type);

// File picker + drop zone for one knowledge block. The whole card is a
// <label> for the file input, so clicking anywhere on it opens the browser's
// native picker directly (no scripted .click()), and the input stays
// keyboard-focusable. Several files at once: PDFs are parsed by the API into
// sections; .txt/.md files are read in the browser into one editable entry each.
function FileUploadCard({ onPdfPages, onTextFile, title }) {
  const [busyFile, setBusyFile] = useState('');
  const [results, setResults] = useState([]); // [{ ok, text }]
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleOne = async (file) => {
    if (isPdf(file)) {
      if (file.size > MAX_PDF_MB * 1024 * 1024) return { ok: false, text: `${file.name}: larger than ${MAX_PDF_MB}MB.` };
      try {
        const data = await api.analyzeCompanyPdf(file);
        onPdfPages(data, file.name);
        const n = data.pages.length;
        return {
          ok: true,
          text: `${file.name}: added ${n} section${n === 1 ? '' : 's'}` + (data.truncated ? ' (long PDF: only the first part was imported)' : '') + '.'
        };
      } catch (err) {
        return { ok: false, text: `${file.name}: ${err.message}` };
      }
    }
    if (isTextFile(file)) {
      if (file.size > MAX_TEXT_FILE_KB * 1024) return { ok: false, text: `${file.name}: text files are limited to ${MAX_TEXT_FILE_KB}KB.` };
      const content = (await file.text()).trim();
      if (!content) return { ok: false, text: `${file.name}: the file is empty.` };
      onTextFile({ title: file.name.replace(/\.(txt|md|markdown)$/i, ''), content, sourceFile: file.name });
      return { ok: true, text: `${file.name}: added as an entry you can edit.` };
    }
    return { ok: false, text: `${file.name}: use a PDF, .txt or .md file.` };
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || busyFile) return;
    setResults([]);
    const out = [];
    // One at a time: the API rate-limits PDF parsing per visitor, and it keeps
    // the progress line honest.
    for (const file of files) {
      setBusyFile(file.name);
      out.push(await handleOne(file));
    }
    setBusyFile('');
    setResults(out);
    if (inputRef.current) inputRef.current.value = ''; // allow choosing the same file again
  };

  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={
          'relative flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 transition focus-within:ring-4 focus-within:ring-indigo-500/20 ' +
          (dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-indigo-400')
        }
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,.pdf,.txt,.md,.markdown,text/plain,text/markdown"
          className="absolute h-px w-px overflow-hidden opacity-0"
          disabled={!!busyFile}
          onChange={(e) => handleFiles(e.target.files)}
        />
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          {busyFile ? <Spinner className="h-4 w-4 text-indigo-600" /> : <UploadIcon className="h-4 w-4" />}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-900">{busyFile ? `Reading ${busyFile}…` : title}</span>
          <span className="block text-xs text-slate-500">
            Click to choose files or drop them here · PDF up to {MAX_PDF_MB}MB, or .txt / .md
          </span>
        </span>
      </label>
      {results.length > 0 && (
        <ul className="mt-2 space-y-0.5" aria-live="polite">
          {results.map((r, i) => (
            <li key={i} className={'text-xs font-medium ' + (r.ok ? 'text-emerald-700' : 'text-red-700')}>{r.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PageRow({ page, onChange }) {
  const [expanded, setExpanded] = useState(!!page.autoExpand);

  if (page.deleted) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-3">
        <span className="truncate text-sm text-slate-400 line-through">{page.title || 'Untitled entry'}</span>
        <button type="button" onClick={() => onChange({ deleted: false })} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800">
          Undo
        </button>
      </div>
    );
  }

  const source = page.url
    ? page.url
    : page.sourceFile
      ? `${/\.pdf$/i.test(page.sourceFile) ? 'PDF' : 'File'} · ${page.sourceFile}`
      : 'Written by you';
  const SourceIcon = page.url ? GlobeIcon : page.sourceFile ? DocumentIcon : PencilIcon;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-3">
          <SourceIcon className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-900">{page.title || 'Untitled entry'}</span>
            <span className="block truncate text-xs text-slate-400">{source}</span>
          </span>
        </span>
        <ChevronDownIcon className={'h-4 w-4 shrink-0 text-slate-400 transition ' + (expanded ? 'rotate-180' : '')} />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3">
          <input
            className={inputClass + ' mb-2'}
            value={page.title}
            placeholder="Title, e.g. Shipping & returns"
            onChange={(e) => onChange({ title: e.target.value })}
          />
          <textarea
            className={inputClass + ' min-h-[140px] font-mono text-xs'}
            value={page.content}
            placeholder={'## A question or topic\n\nThe answer or details, in plain words.\n\n## Another topic\n\n…'}
            onChange={(e) => onChange({ content: e.target.value })}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              Move to block
              <select
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                value={page.category}
                onChange={(e) => onChange({ category: e.target.value })}
              >
                {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.short}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => onChange({ deleted: true })} className="text-xs font-semibold text-red-600 hover:text-red-800">
              Remove entry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Step 3 — Review & launch

function Step3Review({ account, trainablePages, crawledHost, launching, launchError, onBack, onLaunch }) {
  const byCategory = DOC_CATEGORIES.map((c) => ({ ...c, count: trainablePages.filter((p) => p.category === c.id).length }));
  const fromWebsite = trainablePages.filter((p) => p.url).length;
  const fromFiles = trainablePages.length - fromWebsite;

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader
          icon={<SparkIcon className="h-5 w-5" />}
          title="Ready to launch"
          subtitle="This creates your private workspace, your first API key and your dashboard login, then signs you in."
        />
        <dl className="grid gap-x-6 gap-y-4 p-6 sm:grid-cols-2 sm:p-8">
          <SummaryItem label="Company" value={account.companyName} />
          <SummaryItem label="Industry" value={account.industryLabel} />
          <SummaryItem label="Sign-in email" value={account.email} />
          <SummaryItem
            label="Knowledge"
            value={[fromWebsite && `${fromWebsite} from ${crawledHost || 'your website'}`, fromFiles && `${fromFiles} from documents`].filter(Boolean).join(' · ')}
          />
        </dl>
        <div className="grid grid-cols-3 gap-3 border-t border-slate-100 px-6 py-5 sm:px-8">
          {byCategory.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center">
              <div className="text-2xl font-extrabold text-slate-900">{c.count}</div>
              <div className="truncate text-xs font-medium text-slate-500">{c.short}</div>
            </div>
          ))}
        </div>

        {launchError && (
          <div className="mx-6 mb-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 sm:mx-8" role="alert">
            {launchError}{' '}
            {/already exists/i.test(launchError) && <a href="/login" className="font-semibold underline">Sign in</a>}
          </div>
        )}
        {launching && (
          <div className="kgt-fade-up mx-6 mb-2 flex items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 sm:mx-8" aria-live="polite">
            <Spinner className="h-5 w-5 text-indigo-600" />
            <span className="text-sm font-semibold text-indigo-900">Training your bots on {trainablePages.length} entries…</span>
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <button type="button" onClick={onBack} disabled={launching} className={secondaryBtnClass}>
            <ArrowLeftIcon className="h-4 w-4" /> Back to knowledge
          </button>
          <button type="button" onClick={onLaunch} disabled={launching || !trainablePages.length} className={primaryBtnClass}>
            {launching ? <Spinner /> : <SparkIcon className="h-4 w-4" />}
            {launching ? 'Creating your bots…' : 'Create my bots'}
          </button>
        </div>
      </Card>
    </div>
  );
}

function SummaryItem({ label, value }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="m-0 mt-0.5 truncate text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function Card({ children, className = '' }) {
  return <div className={'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ' + className}>{children}</div>;
}

function CardHeader({ icon, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 border-b border-slate-100 px-6 py-5 sm:px-8">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">{icon}</span>
      <div>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function Field({ label, hint, error, className = '', children }) {
  return (
    <label className={'block ' + className}>
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs font-medium text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={'animate-spin ' + className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const inputClass =
  'block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm ' +
  'placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/15';

const primaryBtnClass =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 ' +
  'text-sm font-semibold text-white shadow-md shadow-indigo-600/20 transition hover:from-indigo-500 hover:to-violet-500 ' +
  'focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-500/30 disabled:opacity-40 disabled:shadow-none sm:w-auto';

const secondaryBtnClass =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm ' +
  'font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 sm:w-auto';

// ---------------------------------------------------------------------
// Icons (hand-rolled, no icon-library dependency)

function Svg({ className, children, fill = 'none' }) {
  return (
    <svg
      viewBox="0 0 24 24" fill={fill} className={className} aria-hidden
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
function ShieldIcon({ className }) {
  return <Svg className={className}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></Svg>;
}
function BoltIcon({ className }) {
  return <Svg className={className}><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" /></Svg>;
}
function CheckIcon({ className }) {
  return <Svg className={className}><path d="M20 6L9 17l-5-5" strokeWidth="2.4" /></Svg>;
}
function LockIcon({ className }) {
  return <Svg className={className}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></Svg>;
}
function GlobeIcon({ className }) {
  return <Svg className={className}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" /></Svg>;
}
function DocumentIcon({ className }) {
  return <Svg className={className}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></Svg>;
}
function BuildingIcon({ className }) {
  return <Svg className={className}><path d="M4 21V5a2 2 0 012-2h8a2 2 0 012 2v16M16 9h2a2 2 0 012 2v10M3 21h18M8 7h4M8 11h4M8 15h4" /></Svg>;
}
function ChatIcon({ className }) {
  return <Svg className={className}><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1121 12z" /><path d="M9.5 10a2.5 2.5 0 114 2c-.8.5-1.5 1-1.5 2M12 16.5v.01" /></Svg>;
}
function ScaleIcon({ className }) {
  return <Svg className={className}><path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 006 0L5 7zM19 7l-3 7a3 3 0 006 0l-3-7z" /></Svg>;
}
function UploadIcon({ className }) {
  return <Svg className={className}><path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></Svg>;
}
function PencilIcon({ className }) {
  return <Svg className={className}><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" /></Svg>;
}
function SparkIcon({ className }) {
  return <Svg className={className}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" /></Svg>;
}
function KeyIcon({ className }) {
  return <Svg className={className}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M15 8l2 2" /></Svg>;
}
function CodeIcon({ className }) {
  return <Svg className={className}><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" /></Svg>;
}
function CopyIcon({ className }) {
  return <Svg className={className}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></Svg>;
}
function SendIcon({ className }) {
  return <Svg className={className}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
}
function ArrowRightIcon({ className }) {
  return <Svg className={className}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
}
function ArrowUpIcon({ className }) {
  return <Svg className={className}><path d="M12 19V5M6 11l6-6 6 6" /></Svg>;
}
function ArrowLeftIcon({ className }) {
  return <Svg className={className}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
}
function ChevronDownIcon({ className }) {
  return <Svg className={className}><path d="M6 9l6 6 6-6" /></Svg>;
}
