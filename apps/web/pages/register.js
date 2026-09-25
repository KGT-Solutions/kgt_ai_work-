import { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { api, BASE_URL } from '../lib/api';
// The API suggests a category for every crawled/uploaded page (which block it
// starts in); the visitor can move anything between blocks before training.
import { DOC_CATEGORIES, DEFAULT_CATEGORY, categoryLabel } from '../lib/documentCategories';

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

// Must match CRAWL_CONSENT_STATEMENT in apps/api/src/routes/publicRegister.routes.js,
// which is the copy stored in each tenant's consent record.
const CRAWL_CONSENT_TEXT =
  'I am an authorized representative and legally permit the KGT Solutions AI crawler to access and ' +
  'extract content from this domain.';

// Mirrors MAX_PAGES_ON_COMPLETE in apps/api/src/routes/publicRegister.routes.js
// — the server silently drops anything past it, so stop the visitor here.
const MAX_TRAINING_PAGES = 25;
const MAX_PDF_MB = 10;

const STEPS = [
  { label: 'Enterprise details', sub: 'Company & industry' },
  { label: 'Knowledge source', sub: 'Documents or website' },
  { label: 'Train & deploy', sub: 'Keys, embed & sandbox' }
];

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const isTrainable = (p) => !p.deleted && p.title.trim() && p.content.trim();

export default function RegisterPage() {
  const [step, setStep] = useState(1);

  // Step 1
  const [companyName, setCompanyName] = useState('');
  const [email, setEmail] = useState('');
  const [industryLabel, setIndustryLabel] = useState(INDUSTRIES[0]);

  // Step 2 — 'documents' | 'website' | null (not chosen yet). The two paths are
  // strictly separate: each trains only on its own content, and switching
  // paths hides (but keeps) whatever the other one collected.
  const [sourceMode, setSourceMode] = useState(null);

  // Documents path — PDF sections and hand-written entries, reviewed in the 3 blocks.
  const [pages, setPages] = useState([]);
  // ids must stay unique across repeated uploads (array indexes would collide).
  const nextPageId = useRef(0);
  const withIds = (list) =>
    list.map((p) => ({ category: DEFAULT_CATEGORY, ...p, id: nextPageId.current++, deleted: false }));

  // Website path — crawl, then train straight away (no review blocks).
  const [crawlConsent, setCrawlConsent] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [scrapeStage, setScrapeStage] = useState(null); // null | 'crawling' | 'training'
  const [scrapeError, setScrapeError] = useState('');
  const [crawlStats, setCrawlStats] = useState(null);
  // The last successful crawl, so a failed training call (rate limit, network)
  // can be retried without crawling the same site again.
  const lastCrawl = useRef(null);

  // Step 3
  const [training, setTraining] = useState(false);
  const [trainError, setTrainError] = useState('');
  const [result, setResult] = useState(null);

  const step1Valid = companyName.trim() && isValidEmail(email);
  const trainablePages = pages.filter(isTrainable);

  // websiteConsent: required by the API whenever crawled pages (sourceUrl set)
  // are submitted; it's stored as the tenant's crawl-authorization record.
  const submitRegistration = (list, websiteConsent) =>
    api.completeRegistration({
      companyName: companyName.trim(),
      email: email.trim(),
      industryLabel,
      pages: list.map((p) => ({ title: p.title, content: p.content, category: p.category, sourceUrl: p.url || undefined })),
      websiteConsent
    });

  const runScrapeAndTrain = async () => {
    const url = websiteUrl.trim();
    if (!crawlConsent || !url || scrapeStage) return;
    setScrapeError('');
    try {
      let crawl = lastCrawl.current?.url === url ? lastCrawl.current : null;
      if (!crawl) {
        setScrapeStage('crawling');
        const data = await api.analyzeCompanyUrl(url, { authorized: crawlConsent });
        crawl = { url, pages: data.pages, stats: { crawled: data.crawled, skipped: data.skipped, baseHost: data.baseHost } };
        lastCrawl.current = crawl;
      }
      setCrawlStats(crawl.stats);

      // No review step on this path, so keep the same first-N pages the server's
      // own cap would keep, rather than failing on a large site.
      const trainable = crawl.pages.filter((p) => p.title?.trim() && p.content?.trim()).slice(0, MAX_TRAINING_PAGES);
      if (!trainable.length) {
        throw new Error("We couldn't find enough readable content on that site. Try the document upload path instead.");
      }
      setScrapeStage('training');
      const data = await submitRegistration(trainable, { authorized: crawlConsent, url });
      setResult(data);
      goTo(3);
    } catch (err) {
      setScrapeError(err.message);
    } finally {
      setScrapeStage(null);
    }
  };

  // category: the block the PDF was dropped into — the visitor's explicit
  // choice beats the API's suggestion.
  const addPdfPages = (data, fileName, category) => {
    const added = withIds(data.pages.map((p) => ({ ...p, sourceFile: fileName, ...(category ? { category } : {}) })));
    if (added.length) added[0].autoExpand = true; // "instant preview": open the first parsed part in the editor
    setPages((prev) => [...prev, ...added]);
    return added[0]?.category;
  };

  const addTextPage = (category) => {
    const [page] = withIds([{ title: '', content: '', url: null, category, manual: true, autoExpand: true }]);
    setPages((prev) => [...prev, page]);
  };

  const runTrain = async () => {
    if (training) return;
    if (!trainablePages.length) {
      setTrainError('Keep at least one entry with a title and content — the bots need something to learn from.');
      return;
    }
    if (trainablePages.length > MAX_TRAINING_PAGES) {
      setTrainError(`You can train on up to ${MAX_TRAINING_PAGES} entries — remove ${trainablePages.length - MAX_TRAINING_PAGES} to continue.`);
      return;
    }
    setTrainError('');
    setTraining(true);
    try {
      setResult(await submitRegistration(trainablePages));
    } catch (err) {
      setTrainError(err.message);
    } finally {
      setTraining(false);
    }
  };

  const goTo = (n) => {
    setStep(n);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <Head>
        <title>Enterprise Onboarding — KGT Solutions AI Hub</title>
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
        @keyframes kgtConfetti {
          0% { opacity: 1; transform: translateY(0) rotate(0deg); }
          100% { opacity: 0; transform: translateY(180px) rotate(540deg); }
        }
        @media (prefers-reduced-motion: reduce) { .kgt-fade-up { animation: none; } }
      `}</style>

      <div
        className="kgt-onboard min-h-screen bg-slate-50 text-slate-900 antialiased"
        style={{ fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' }}
      >
        <TopBar />
        <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
          <PageHeader />
          <StepIndicator step={result ? 4 : step} />

          <div key={result ? 'done' : step} className="kgt-fade-up">
            {step === 1 && (
              <Step1Details
                companyName={companyName} setCompanyName={setCompanyName}
                email={email} setEmail={setEmail}
                industryLabel={industryLabel} setIndustryLabel={setIndustryLabel}
                valid={step1Valid}
                onNext={() => goTo(2)}
              />
            )}

            {step === 2 && (
              <Step2KnowledgeSource
                sourceMode={sourceMode} setSourceMode={setSourceMode}
                crawlConsent={crawlConsent} setCrawlConsent={setCrawlConsent}
                websiteUrl={websiteUrl} setWebsiteUrl={setWebsiteUrl}
                scrapeStage={scrapeStage} scrapeError={scrapeError} crawlStats={crawlStats}
                onScrapeAndTrain={runScrapeAndTrain}
                pages={pages} setPages={setPages}
                trainableCount={trainablePages.length}
                onPdfPages={addPdfPages} onAddText={addTextPage}
                onBack={() => goTo(1)}
                onNext={() => goTo(3)}
              />
            )}

            {step === 3 && !result && (
              <Step3Train
                companyName={companyName} email={email} industryLabel={industryLabel}
                trainablePages={trainablePages}
                training={training} trainError={trainError}
                onBack={() => goTo(2)}
                onTrain={runTrain}
              />
            )}

            {step === 3 && result && <Step3Success companyName={companyName} result={result} />}
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
          KGT staff? <span className="font-semibold text-indigo-600">Operator sign in</span>
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
        <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent">Enterprise Onboarding</span>
      </h1>
      <p className="mx-auto mt-3 max-w-2xl text-base text-slate-600">
        Launch a grounded Support Bot and a conversion-focused Sales Bot, trained on your own knowledge, in three steps.
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
// Step 1 — Enterprise details & industry

function Step1Details({ companyName, setCompanyName, email, setEmail, industryLabel, setIndustryLabel, valid, onNext }) {
  const [touched, setTouched] = useState(false);
  const emailInvalid = touched && email.trim() && !isValidEmail(email);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (valid) onNext();
      }}
      className="mx-auto max-w-2xl"
    >
      <Card>
        <CardHeader
          icon={<BuildingIcon className="h-5 w-5" />}
          title="Enterprise details"
          subtitle="Tell us who you are. Nothing is created until you start training."
        />
        <div className="grid gap-5 p-6 sm:grid-cols-2 sm:p-8">
          <Field label="Company name" className="sm:col-span-2">
            <input
              className={inputClass}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corporation"
              autoComplete="organization"
              required
            />
          </Field>
          <Field label="Business email" error={emailInvalid ? 'Enter a valid email address.' : ''}>
            <input
              type="email"
              className={inputClass + (emailInvalid ? ' border-red-400 focus:border-red-500 focus:ring-red-500/20' : '')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="you@company.com"
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Industry">
            <div className="relative">
              <select
                className={inputClass + ' appearance-none pr-10'}
                value={industryLabel}
                onChange={(e) => setIndustryLabel(e.target.value)}
              >
                {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:px-8">
          <p className="hidden text-xs text-slate-500 sm:block">Your industry tunes each bot's tone and vocabulary.</p>
          <button type="submit" disabled={!valid} className={primaryBtnClass}>
            Continue <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>
      </Card>
    </form>
  );
}

// ---------------------------------------------------------------------
// Step 2 — Knowledge source fork

function Step2KnowledgeSource({
  sourceMode, setSourceMode, crawlConsent, setCrawlConsent, websiteUrl, setWebsiteUrl,
  scrapeStage, scrapeError, crawlStats, onScrapeAndTrain, pages, setPages, trainableCount,
  onPdfPages, onAddText, onBack, onNext
}) {
  const updatePage = (id, patch) => setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const busy = !!scrapeStage;

  return (
    <div className="mx-auto max-w-4xl">
      <TrainingTip />

      <div className="mt-10 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-600">Step 2 of 3 · Knowledge source</p>
        <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem]">Choose your training method</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
          Pick where your bots should learn from. You can switch methods at any time before training starts.
        </p>
      </div>

      <div role="radiogroup" aria-label="Training method" className="mt-8 grid gap-5 md:grid-cols-2">
        <SourceCard
          selected={sourceMode === 'documents'}
          onSelect={() => setSourceMode('documents')}
          disabled={busy}
          recommended
          icon={<DocumentIcon className="h-6 w-6" />}
          title="Upload Structured Documents"
          badge="Best for secure or private company data"
          points={['PDFs or pasted text, nothing leaves your control', 'Organized into Overview, FAQs, and Policies', 'Ideal for internal manuals and pricing sheets']}
        />
        <SourceCard
          selected={sourceMode === 'website'}
          onSelect={() => setSourceMode('website')}
          disabled={busy}
          icon={<GlobeIcon className="h-6 w-6" />}
          title="Auto-Scrape Website URL"
          badge="Best for public sites, blogs, and marketing pages"
          points={['Two-tier crawler discovers and structures pages', 'Auto-sorts content into Overview, FAQs, and Policies', 'One click from URL to trained bots']}
        />
      </div>

      {!sourceMode && (
        <p className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500">
          <ArrowUpIcon className="h-4 w-4 text-slate-400" /> Select a method above to continue.
        </p>
      )}

      {/* Strict conditional rendering: exactly one path's UI is ever mounted. */}
      {sourceMode === 'documents' && (
        <div key="documents" className="kgt-fade-up mt-6 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900">Your knowledge blocks</h3>
              <p className="text-sm text-slate-500">
                Upload a PDF or write entries for each block. Fill as many as you like; one is enough to start.
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
              onAddText={() => onAddText(c.id)}
            />
          ))}
        </div>
      )}

      {sourceMode === 'website' && (
        <div key="website" className="kgt-fade-up mt-6">
          <WebScrapeCard
            crawlConsent={crawlConsent} setCrawlConsent={setCrawlConsent}
            websiteUrl={websiteUrl} setWebsiteUrl={setWebsiteUrl}
            scrapeStage={scrapeStage} scrapeError={scrapeError} crawlStats={crawlStats}
            onSubmit={onScrapeAndTrain}
            onSwitchToDocuments={() => setSourceMode('documents')}
          />
        </div>
      )}

      <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onBack} disabled={busy} className={secondaryBtnClass}>
          <ArrowLeftIcon className="h-4 w-4" /> Back
        </button>
        {/* The website path trains from its own card; only documents need a step 3. */}
        {sourceMode === 'documents' && (
          <div className="flex flex-col items-stretch gap-1 sm:items-end">
            <button type="button" onClick={onNext} disabled={trainableCount === 0} className={primaryBtnClass}>
              Continue to training <ArrowRightIcon className="h-4 w-4" />
            </button>
            {trainableCount === 0 && (
              <span className="text-center text-xs text-slate-500 sm:text-right">Add at least one entry with a title and content.</span>
            )}
            {trainableCount > MAX_TRAINING_PAGES && (
              <span className="text-center text-xs font-medium text-amber-700 sm:text-right">
                Over the {MAX_TRAINING_PAGES}-entry limit — remove {trainableCount - MAX_TRAINING_PAGES} before training.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
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

function SourceCard({ selected, onSelect, disabled, recommended, icon, title, badge, points }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      disabled={disabled}
      className={
        'group relative flex h-full flex-col rounded-2xl border-2 bg-white p-6 text-left transition duration-200 disabled:opacity-60 ' +
        (selected
          ? 'border-indigo-600 shadow-lg shadow-indigo-600/10 ring-4 ring-indigo-100'
          : 'border-slate-200 shadow-sm enabled:hover:-translate-y-0.5 enabled:hover:border-slate-300 enabled:hover:shadow-md')
      }
    >
      {recommended && (
        <span className="absolute -top-3 left-6 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm">
          Recommended
        </span>
      )}
      <span
        className={
          'absolute right-5 top-5 flex h-6 w-6 items-center justify-center rounded-full border-2 transition ' +
          (selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white text-transparent')
        }
      >
        <CheckIcon className="h-3.5 w-3.5" />
      </span>
      <span
        className={
          'flex h-12 w-12 items-center justify-center rounded-xl transition ' +
          (selected ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white' : 'bg-slate-100 text-slate-600 group-hover:bg-indigo-50 group-hover:text-indigo-600')
        }
      >
        {icon}
      </span>
      <span className="mt-4 block pr-8 text-lg font-bold text-slate-900">{title}</span>
      <span className={'mt-1.5 inline-block w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ' + (selected ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-600')}>
        {badge}
      </span>
      <span className="mt-4 block space-y-2">
        {points.map((p) => (
          <span key={p} className="flex items-start gap-2 text-sm text-slate-600">
            <CheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span>{p}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

function WebScrapeCard({
  crawlConsent, setCrawlConsent, websiteUrl, setWebsiteUrl, scrapeStage, scrapeError, crawlStats,
  onSubmit, onSwitchToDocuments
}) {
  const [statusIndex, setStatusIndex] = useState(0);
  useEffect(() => {
    if (scrapeStage !== 'crawling') return undefined;
    setStatusIndex(0);
    const id = setInterval(() => setStatusIndex((i) => Math.min(i + 1, CRAWL_STATUS_MESSAGES.length - 1)), 2200);
    return () => clearInterval(id);
  }, [scrapeStage]);

  const busy = !!scrapeStage;
  const canSubmit = crawlConsent && websiteUrl.trim() && !busy;
  const statusText =
    scrapeStage === 'training'
      ? `Training your Support & Sales bots${crawlStats?.baseHost ? ` on content from ${crawlStats.baseHost}` : ''}…`
      : CRAWL_STATUS_MESSAGES[statusIndex];
  // Crawl fills the bar to ~70%, training carries it to ~95%; it only completes on success.
  const progress = scrapeStage === 'training' ? 95 : ((statusIndex + 1) / CRAWL_STATUS_MESSAGES.length) * 70;

  return (
    <Card>
      <CardHeader
        icon={<GlobeIcon className="h-5 w-5" />}
        title="Enterprise AI Crawler"
        subtitle="We'll crawl your site, structure what we find, and train both bots in one go."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit();
        }}
        className="space-y-5 p-6 sm:p-8"
      >
        <Field label="Website URL">
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
              <GlobeIcon className="h-4 w-4" />
            </span>
            <input
              type="url"
              inputMode="url"
              className={inputClass + ' py-3 pl-10 disabled:bg-slate-100 disabled:text-slate-400'}
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://mycompany.com"
              disabled={busy}
              required
            />
          </div>
        </Field>

        <div className="flex gap-3 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-violet-50 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm">
            <ShieldIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-indigo-900">Crawler permission &amp; security</p>
            <p className="mt-1 text-sm leading-relaxed text-indigo-900/80">{CRAWLER_PERMISSION_TEXT}</p>
          </div>
        </div>

        <label
          className={
            'flex cursor-pointer items-start gap-3 rounded-xl border-2 p-4 transition ' +
            (crawlConsent ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white hover:border-slate-300')
          }
        >
          <input
            type="checkbox"
            checked={crawlConsent}
            onChange={(e) => setCrawlConsent(e.target.checked)}
            disabled={busy}
            required
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-indigo-600"
          />
          <span className="text-sm leading-relaxed text-slate-700">
            {CRAWL_CONSENT_TEXT} <span className="font-semibold text-red-600">*</span>
          </span>
        </label>

        {busy && (
          <div className="kgt-fade-up rounded-xl border border-indigo-100 bg-indigo-50/60 p-4" aria-live="polite">
            <div className="flex items-center gap-3">
              <Spinner className="h-5 w-5 text-indigo-600" />
              <p className="text-sm font-semibold text-indigo-900">{statusText}</p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-indigo-100">
              <div className="h-full rounded-full bg-indigo-600 transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-xs text-indigo-700/80">Usually under a minute. Please keep this tab open.</p>
          </div>
        )}

        {!busy && scrapeError && (
          <div className="kgt-fade-up rounded-xl border border-red-200 bg-red-50 p-4" role="alert">
            <p className="text-sm font-semibold text-red-800">Something went wrong</p>
            <p className="mt-1 text-sm text-red-700">{scrapeError}</p>
            <p className="mt-3 text-sm text-red-800">
              JavaScript-heavy or protected sites often can't be crawled.{' '}
              <button type="button" onClick={onSwitchToDocuments} className="font-semibold text-red-900 underline underline-offset-2">
                Upload documents instead
              </button>
            </p>
          </div>
        )}

        <button type="submit" disabled={!canSubmit} className={primaryBtnClass + ' !w-full py-3.5 text-base'}>
          {busy ? <Spinner /> : <SparkIcon className="h-5 w-5" />}
          {scrapeStage === 'crawling' ? 'Scraping website…' : scrapeStage === 'training' ? 'Training AI…' : 'Start Web Scraping & Train AI'}
        </button>
        {!busy && !canSubmit && (
          <p className="-mt-2 text-center text-xs text-slate-500">
            {!websiteUrl.trim() && !crawlConsent
              ? 'Enter your website URL and tick the authorization box to continue.'
              : !websiteUrl.trim()
                ? 'Enter your website URL to continue.'
                : 'Tick the authorization box to continue.'}
          </p>
        )}
      </form>
    </Card>
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
          <PdfUploadCard onPages={onPdfPages} title={`Upload a PDF to ${category.short}`} />
          <button
            type="button"
            onClick={onAddText}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white px-5 py-4 text-sm font-semibold text-slate-700 transition hover:border-indigo-400 hover:text-indigo-700"
          >
            <PencilIcon className="h-4 w-4" /> Paste or write text
          </button>
        </div>
      </div>
    </Card>
  );
}

function PdfUploadCard({ onPages, title }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file || uploading) return;
    setError('');
    setNotice('');
    // Client-side checks are only for a fast, friendly error — the server
    // enforces both (plus a %PDF- magic-byte check) regardless.
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      setError('Please choose a PDF file.');
      return;
    }
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      setError(`That file is larger than ${MAX_PDF_MB}MB.`);
      return;
    }
    setUploading(true);
    try {
      const data = await api.analyzeCompanyPdf(file);
      const landedIn = onPages(data, file.name);
      setNotice(
        `Added ${data.pages.length} section${data.pages.length === 1 ? '' : 's'} from ${file.name}` +
        (landedIn ? ` to ${categoryLabel(landedIn)}` : '') +
        (data.truncated ? ' — the PDF was too long, so only the first part was imported.' : '.')
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = ''; // allow re-selecting the same file
    }
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        className={
          'flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 transition ' +
          (dragOver ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-indigo-400')
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onClick={(e) => e.stopPropagation()} // inputRef.click() bubbles to the dropzone's own onClick
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
          {uploading ? <Spinner className="h-4 w-4 text-indigo-600" /> : <UploadIcon className="h-4 w-4" />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">{uploading ? 'Reading your PDF…' : title}</span>
          <span className="block text-xs text-slate-500">Drop a file or click to browse · text-based PDFs up to {MAX_PDF_MB}MB</span>
        </span>
      </div>
      {error && <p className="mt-2 text-xs font-medium text-red-700">{error}</p>}
      {notice && <p className="mt-2 text-xs font-medium text-emerald-700">{notice}</p>}
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

  const source = page.url ? page.url : page.sourceFile ? `PDF · ${page.sourceFile}` : 'Written by you';
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
// Step 3 — Train, then credentials + sandbox

// Documents path only — the website path trains straight from its Step 2 card.
function Step3Train({ companyName, email, industryLabel, trainablePages, training, trainError, onBack, onTrain }) {
  const byCategory = DOC_CATEGORIES.map((c) => ({ ...c, count: trainablePages.filter((p) => p.category === c.id).length }));

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader
          icon={<SparkIcon className="h-5 w-5" />}
          title="Ready to train your bots"
          subtitle="Confirm the details below, then start training. Your tenant and API key are created in this step."
        />
        <dl className="grid gap-x-6 gap-y-4 p-6 sm:grid-cols-2 sm:p-8">
          <SummaryItem label="Company" value={companyName} />
          <SummaryItem label="Business email" value={email} />
          <SummaryItem label="Industry" value={industryLabel} />
          <SummaryItem
            label="Knowledge source"
            value="Structured documents"
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

        {trainError && (
          <div className="mx-6 mb-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 sm:mx-8">{trainError}</div>
        )}

        {training && (
          <div className="kgt-fade-up mx-6 mb-2 flex items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 sm:mx-8">
            <Spinner className="h-5 w-5 text-indigo-600" />
            <span className="text-sm font-semibold text-indigo-900">Indexing {trainablePages.length} entries and provisioning your tenant…</span>
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 bg-slate-50/70 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <button type="button" onClick={onBack} disabled={training} className={secondaryBtnClass}>
            <ArrowLeftIcon className="h-4 w-4" /> Back to knowledge
          </button>
          <button type="button" onClick={onTrain} disabled={training || !trainablePages.length} className={primaryBtnClass}>
            {training ? <Spinner /> : <SparkIcon className="h-4 w-4" />}
            {training ? 'Training your bots…' : 'Start AI Training'}
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

function Step3Success({ companyName, result }) {
  const embedCode =
    `<script src="${BASE_URL}/widgets/tenant-chat-widget.js" ` +
    `data-tenant-id="${result.slug}" data-api-key="${result.apiKey}" defer></script>`;

  return (
    <div>
      <div className="relative mx-auto max-w-xl overflow-hidden text-center">
        <Confetti />
        <div className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-lg shadow-emerald-500/30 ring-8 ring-emerald-100">
          <CheckIcon className="h-8 w-8" />
        </div>
        <h2 className="relative mt-5 text-3xl font-extrabold tracking-tight text-slate-900">{companyName} is live 🎉</h2>
        <p className="relative mt-2 text-sm text-slate-600">
          Trained on {result.documentsCreated} document{result.documentsCreated === 1 ? '' : 's'}. Both bots are answering right now.
        </p>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-[1fr,1.1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader icon={<KeyIcon className="h-5 w-5" />} title="Secure credentials" subtitle="" />
            <div className="space-y-4 p-6">
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <ShieldIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Store your API key somewhere safe — it's shown only once.</span>
              </div>
              <CopyField label="Tenant ID" value={result.tenantId} />
              <CopyField label="API Key" value={result.apiKey} secret />
            </div>
          </Card>

          <Card>
            <CardHeader icon={<CodeIcon className="h-5 w-5" />} title="Embed on your website" subtitle="Paste before the closing </body> tag." />
            <div className="p-6">
              <CodeBlock value={embedCode} />
            </div>
          </Card>
        </div>

        <TestBotSandbox slug={result.slug} apiKey={result.apiKey} companyName={companyName} />
      </div>
    </div>
  );
}

function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (value) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard access denied — the value stays selectable by hand
    }
  };
  return [copied, copy];
}

function CopyButton({ copied, onClick, dark }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ' +
        (copied
          ? 'bg-emerald-500 text-white'
          : dark ? 'bg-white/10 text-slate-200 hover:bg-white/20' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
      }
    >
      {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CopyField({ label, value, secret }) {
  const [copied, copy] = useCopy();
  const [revealed, setRevealed] = useState(!secret);
  const shown = revealed ? value : `${value.slice(0, 6)}${'•'.repeat(18)}${value.slice(-4)}`;

  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-slate-800">{shown}</code>
        {secret && (
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            className="shrink-0 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
          >
            {revealed ? 'Hide' : 'Reveal'}
          </button>
        )}
        <CopyButton copied={copied} onClick={() => copy(value)} />
      </div>
    </div>
  );
}

function CodeBlock({ value }) {
  const [copied, copy] = useCopy();
  return (
    <div className="overflow-hidden rounded-xl bg-slate-900">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="font-mono text-xs text-slate-400">index.html</span>
        <CopyButton copied={copied} onClick={() => copy(value)} dark />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all p-4 font-mono text-xs leading-relaxed text-emerald-300">{value}</pre>
    </div>
  );
}

const BOT_TABS = [
  { id: 'support', label: 'Support Bot', icon: ShieldIcon, starter: 'What is your refund policy?' },
  { id: 'sales', label: 'Sales Bot', icon: BoltIcon, starter: 'Which plan is right for a team of 20?' }
];

function TestBotSandbox({ slug, apiKey, companyName }) {
  const [botType, setBotType] = useState('support');
  const [sessionIds, setSessionIds] = useState({});
  const [messages, setMessages] = useState({ support: [], sales: [] });
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, botType, sending]);

  const send = async (text) => {
    const query = text.trim();
    if (!query || sending) return;
    // Capture the tab at send time — the visitor may switch tabs mid-request.
    const bot = botType;
    setInput('');
    setSending(true);
    setMessages((m) => ({ ...m, [bot]: [...m[bot], { role: 'user', text: query }] }));
    try {
      const res = await fetch(`${BASE_URL}/api/v1/tenant-chat/${slug}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-api-key': apiKey },
        body: JSON.stringify({ query, botType: bot, sessionId: sessionIds[bot] })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The bot could not respond');
      setSessionIds((s) => ({ ...s, [bot]: data.sessionId }));
      setMessages((m) => ({ ...m, [bot]: [...m[bot], { role: 'assistant', text: data.answer }] }));
    } catch (err) {
      setMessages((m) => ({ ...m, [bot]: [...m[bot], { role: 'assistant', text: err.message, error: true }] }));
    } finally {
      setSending(false);
    }
  };

  const active = BOT_TABS.find((t) => t.id === botType);
  const activeMessages = messages[botType];

  return (
    <Card className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <h3 className="text-sm font-bold text-slate-900">Live testing sandbox</h3>
        </div>
        <div role="tablist" aria-label="Bot" className="flex rounded-xl bg-slate-100 p-1">
          {BOT_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={botType === t.id}
              onClick={() => setBotType(t.id)}
              className={
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ' +
                (botType === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')
              }
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="flex h-80 flex-col gap-2.5 overflow-y-auto bg-slate-50/60 px-5 py-4">
        {activeMessages.length === 0 && (
          <div className="m-auto max-w-xs text-center">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <active.icon className="h-5 w-5" />
            </span>
            <p className="mt-3 text-sm font-semibold text-slate-800">Chat with {companyName}'s {active.label}</p>
            <p className="mt-1 text-xs text-slate-500">Ask something covered by the knowledge you just trained on.</p>
            <button
              type="button"
              onClick={() => send(active.starter)}
              className="mt-3 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-indigo-300 hover:text-indigo-700"
            >
              “{active.starter}”
            </button>
          </div>
        )}
        {activeMessages.map((m, i) => (
          <div
            key={i}
            className={
              'kgt-fade-up max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ' +
              (m.role === 'user'
                ? 'ml-auto rounded-br-md bg-indigo-600 text-white'
                : m.error
                  ? 'rounded-bl-md border border-red-200 bg-red-50 text-red-700'
                  : 'rounded-bl-md border border-slate-200 bg-white text-slate-800 shadow-sm')
            }
          >
            {m.text}
          </div>
        ))}
        {sending && (
          <div className="flex w-fit gap-1 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 shadow-sm">
            {[0, 150, 300].map((d) => (
              <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t border-slate-100 p-3"
      >
        <input
          className={inputClass}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask the ${active.label}…`}
          disabled={sending}
        />
        <button type="submit" disabled={sending || !input.trim()} className={primaryBtnClass + ' shrink-0 !px-4'} aria-label="Send">
          <SendIcon className="h-4 w-4" />
        </button>
      </form>
    </Card>
  );
}

// Pure-CSS celebration burst — no dependency, skipped under reduced motion.
function Confetti() {
  const colors = ['bg-indigo-500', 'bg-violet-500', 'bg-emerald-400', 'bg-amber-400', 'bg-sky-400'];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
      {Array.from({ length: 18 }).map((_, i) => (
        <span
          key={i}
          className={`absolute h-2 w-1 rounded-sm ${colors[i % colors.length]}`}
          style={{
            left: `${(i * 53) % 100}%`,
            top: '-10px',
            animation: `kgtConfetti ${1.6 + (i % 5) * 0.25}s ease-in ${(i % 6) * 0.08}s both`,
            transform: `rotate(${i * 37}deg)`
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// Shared primitives

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
