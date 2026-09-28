import Head from 'next/head';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, ButtonLink, CopyButton, Logo, cx } from '../components/ui';
import {
  IconArrowRight, IconBolt, IconCheck, IconCode, IconDocs, IconGlobe, IconKey, IconLayers, IconLock, IconShield, IconSpark, IconUpload
} from '../components/ui/icons';
import { BASE_URL } from '../lib/api';

// Public landing page.
export default function Landing() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-obsidian">
      <Head><title>KGT AI Hub — Support & Sales AI bots for your website</title></Head>
      <Nav />
      <Hero />
      <DeveloperPreview />
      <Features />
      <HowItWorks />
      <FinalCta />
      <Footer />
    </div>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-obsidian/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" aria-label="KGT AI Hub home"><Logo /></Link>
        <nav className="hidden items-center gap-7 text-sm text-fg-2 md:flex" aria-label="Main">
          <a href="#features" className="hover:text-fg">Features</a>
          <a href="#developers" className="hover:text-fg">Developers</a>
          <a href="#how" className="hover:text-fg">How it works</a>
        </nav>
        <div className="flex items-center gap-2">
          <ButtonLink href="/login" variant="ghost" size="sm">Sign in</ButtonLink>
          <ButtonLink href="/register" variant="primary" size="sm">Get started</ButtonLink>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative">
      <div className="bg-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="pointer-events-none absolute left-1/2 top-[-10rem] h-[30rem] w-[60rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-cyan-500/20 via-sky-500/10 to-violet-500/25 blur-3xl" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-16 lg:grid-cols-[1.1fr_1fr] lg:pt-24">
        <div className="animate-fade-up">
          <Badge tone="cyan" className="mb-5"><IconSpark className="h-3 w-3" />Support + Sales, one knowledge base</Badge>
          <h1 className="text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-fg sm:text-5xl lg:text-[3.4rem]">
            Deploy grounded <span className="text-gradient">Support & Sales AI bots</span> on your website in minutes.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-fg-2">
            Point us at your site or drop in your PDFs. You get a Support Bot that answers only from your documents and a Sales
            Bot that sells your real strengths — isolated to your company, embedded with one script tag.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/register" variant="primary" size="lg">Get started free <IconArrowRight className="h-4 w-4" /></ButtonLink>
            <ButtonLink href="/login" variant="secondary" size="lg">Sign in</ButtonLink>
          </div>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-3">
            {['No code to write', 'Website + PDF training', 'Keys stored as hashes'].map((t) => (
              <li key={t} className="flex items-center gap-2"><IconCheck className="h-4 w-4 text-cyan-300" />{t}</li>
            ))}
          </ul>
        </div>
        <WidgetPreview />
      </div>
    </section>
  );
}

// Scripted demo of the embed widget — plainly labelled as a preview.
const DEMO = {
  support: [
    { role: 'user', text: 'Can I return an opened product?' },
    { role: 'bot', text: 'Yes — opened items can be returned within 14 days for store credit. Unopened items get a full refund within 30 days.', meta: 'Source · Returns policy' }
  ],
  sales: [
    { role: 'user', text: 'Why should we pick you over our current tool?' },
    { role: 'bot', text: 'You’d be live in minutes with no code, and your team only sees the questions the bot genuinely can’t answer. Want me to walk you through setup?', meta: 'Fast Setup · Fewer Tickets' }
  ]
};

function WidgetPreview() {
  const [bot, setBot] = useState('support');
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const timers = [setTimeout(() => setShown(1), 400), setTimeout(() => setShown(2), 1500)];
    const next = setTimeout(() => setBot((b) => (b === 'support' ? 'sales' : 'support')), 7000);
    return () => { timers.forEach(clearTimeout); clearTimeout(next); };
  }, [bot]);

  const messages = DEMO[bot].slice(0, shown);
  const isSales = bot === 'sales';

  return (
    <div className="relative mx-auto w-full max-w-md animate-fade-up [animation-delay:120ms]">
      <div className={cx('absolute -inset-6 rounded-[2rem] blur-2xl transition-colors duration-700', isSales ? 'bg-violet-500/15' : 'bg-cyan-500/15')} aria-hidden="true" />
      <div className="glass relative overflow-hidden" aria-label="Preview of the chat widget">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-obsidian/70', isSales ? 'text-violet-300' : 'text-cyan-300')}>
              {isSales ? <IconBolt className="h-4 w-4" /> : <IconShield className="h-4 w-4" />}
            </span>
            <div>
              <p className="text-sm font-semibold text-fg">{isSales ? 'Sales Bot' : 'Support Bot'}</p>
              <p className="flex items-center gap-1.5 text-[11px] text-fg-3"><span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-400" />Online · answers from your docs</p>
            </div>
          </div>
          <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-[11px]">
            {['support', 'sales'].map((b) => (
              <button key={b} type="button" onClick={() => setBot(b)}
                className={cx('rounded-md px-2.5 py-1 font-medium capitalize transition', bot === b ? 'bg-white/10 text-fg' : 'text-fg-3')}>{b}</button>
            ))}
          </div>
        </div>
        <div className="flex h-[300px] flex-col gap-3 px-4 py-5" aria-live="polite">
          {messages.map((m, i) => m.role === 'user' ? (
            <div key={`${bot}-${i}`} className="ml-auto max-w-[80%] animate-fade-up rounded-2xl rounded-br-md bg-white/[0.08] px-3.5 py-2 text-sm text-fg">{m.text}</div>
          ) : (
            <div key={`${bot}-${i}`} className="max-w-[88%] animate-fade-up">
              <div className="rounded-2xl rounded-bl-md border border-white/[0.08] bg-panel-2/80 px-3.5 py-2.5 text-sm leading-relaxed text-fg">{m.text}</div>
              <p className={cx('mt-1.5 pl-1 text-[11px]', isSales ? 'text-violet-300' : 'text-cyan-300')}>{m.meta}</p>
            </div>
          ))}
          {shown === 1 && (
            <div className="flex w-fit gap-1 rounded-2xl rounded-bl-md border border-white/[0.08] bg-panel-2/80 px-3.5 py-3">
              {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-3" style={{ animationDelay: `${d}ms` }} />)}
            </div>
          )}
        </div>
        <div className="border-t border-white/[0.06] p-3">
          <div className="flex h-10 items-center rounded-lg border border-white/10 bg-obsidian/60 px-3 text-sm text-fg-3">Ask a question…</div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-fg-3">Preview — a sample conversation.</p>
    </div>
  );
}

function DeveloperPreview() {
  const [tab, setTab] = useState('embed');
  const key = 'tk_3f9a1c••••••••••••••••••••••••7b2e';
  const snippets = {
    key: { file: 'your API key', code: `${key}\n\n# Issued once, stored only as a SHA-256 fingerprint.\n# Rotate any time: issue a new key, update the embed, revoke the old one.` },
    embed: { file: 'index.html', code: `<script src="${BASE_URL}/widgets/tenant-chat-widget.js"\n        data-tenant-id="acme"\n        data-api-key="tk_…"\n        defer></script>` },
    curl: { file: 'terminal', code: `curl -X POST ${BASE_URL}/api/v1/tenant-chat/acme/chat \\\n  -H "X-Tenant-Api-Key: tk_…" \\\n  -H "Content-Type: application/json" \\\n  -d '{"query":"What is your refund policy?","botType":"support"}'` }
  };
  const s = snippets[tab];

  return (
    <section id="developers" className="relative border-y border-white/[0.06] bg-panel/40">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 lg:grid-cols-2">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-cyan-300">Developers</p>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-fg">One key. One script tag. Both bots.</h2>
          <p className="mt-4 text-fg-2">
            Every company gets its own <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[13px] text-cyan-100">tk_…</code> key. Drop the
            snippet into your site and visitors can switch between Support and Sales — or call the same endpoint from your own app.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-fg-2">
            {[[IconKey, 'Keys shown once, stored as SHA-256 fingerprints, revocable instantly.'],
              [IconCode, 'Plain HTTPS + JSON — no SDK required.'],
              [IconLock, 'A key only ever reaches the company that owns it.']].map(([Icon, t]) => (
              <li key={t} className="flex gap-3"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />{t}</li>
            ))}
          </ul>
        </div>
        <div className="glass overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-2 py-1.5">
            <div role="tablist" aria-label="Integration" className="flex">
              {[['key', 'API key'], ['embed', 'Embed'], ['curl', 'cURL']].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={cx('rounded-md px-3 py-1.5 text-[13px] font-medium transition', tab === id ? 'bg-white/[0.07] text-fg' : 'text-fg-3 hover:text-fg-2')}>{label}</button>
              ))}
            </div>
            <CopyButton value={s.code} />
          </div>
          <div className="flex items-center gap-1.5 px-4 pt-3">
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" /><span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="ml-2 font-mono text-[11px] text-fg-3">{s.file}</span>
          </div>
          <pre className="overflow-x-auto p-4 pt-3 text-[12.5px] leading-relaxed text-cyan-50/90"><code>{s.code}</code></pre>
        </div>
      </div>
    </section>
  );
}

const FEATURES = [
  { icon: IconGlobe, title: 'Two-tier website scraping', tone: 'text-cyan-300',
    body: 'A fast static crawler reads your public pages, strips menus, footers and cookie banners, and files each page as Overview, FAQ or Policy. JavaScript-heavy sites fall back to a sandboxed headless browser.' },
  { icon: IconShield, title: 'Zero-guess support gate', tone: 'text-cyan-300',
    body: 'The Support Bot answers only from your documents. When a question doesn’t clear its confidence gate it says so, hands off politely, and files a ticket instead of making something up.' },
  { icon: IconBolt, title: 'Conversion-focused sales', tone: 'text-violet-300',
    body: 'The Sales Bot leads with the benefit that matters to each visitor, handles price and competitor objections from your own material, and ends every answer with a next step.' },
  { icon: IconLock, title: 'Strict tenant isolation', tone: 'text-violet-300',
    body: 'Every company’s documents, keys, chats and usage are walled off. Sessions and API keys are scoped server-side, so one company’s data can never reach another’s bots.' },
  { icon: IconUpload, title: 'PDF, .txt and .md ingestion', tone: 'text-cyan-300',
    body: 'Drag in manuals, FAQs and price lists. Headings become separate, searchable sections — typos in questions are corrected against your own vocabulary.' },
  { icon: IconLayers, title: 'One knowledge base, two personas', tone: 'text-violet-300',
    body: 'Both bots share the same documents but weigh them differently: FAQs first for support, your positioning first for sales, policies always authoritative.' }
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-24">
      <div className="max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.16em] text-violet-300">Platform</p>
        <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-fg">Built to be trusted with your customers.</h2>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="glass group p-6 transition hover:border-white/15">
            <span className={cx('flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-obsidian/60', f.tone)}><f.icon className="h-5 w-5" /></span>
            <h3 className="mt-5 text-base font-semibold text-fg">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-fg-2">{f.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { icon: IconDocs, title: 'Tell us about your company', body: 'Name, industry and a sign-in for your private dashboard.' },
    { icon: IconUpload, title: 'Add your knowledge', body: 'Scan your website, upload documents, or both — review everything before launch.' },
    { icon: IconSpark, title: 'Launch and embed', body: 'Your bots go live instantly. Copy the key and snippet, test both bots side by side.' }
  ];
  return (
    <section id="how" className="border-t border-white/[0.06]">
      <div className="mx-auto max-w-6xl px-5 py-24">
        <h2 className="text-balance text-3xl font-semibold tracking-tight text-fg">Live in three steps.</h2>
        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="glass p-6">
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-fg-3">0{i + 1}</span>
                <s.icon className="h-5 w-5 text-cyan-300" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-fg">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fg-2">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="px-5 pb-24">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-500/[0.12] via-panel to-violet-500/[0.14] px-8 py-14 text-center">
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
        <h2 className="relative text-balance text-3xl font-semibold tracking-tight text-fg">Give every visitor an answer — and a reason to buy.</h2>
        <p className="relative mx-auto mt-3 max-w-xl text-fg-2">Set up takes minutes. Your data trains only your bots.</p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/register" variant="primary" size="lg">Create your bots <IconArrowRight className="h-4 w-4" /></ButtonLink>
          <ButtonLink href="/login" variant="secondary" size="lg">Sign in</ButtonLink>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-fg-3 sm:flex-row">
        <Logo />
        <p>© {new Date().getFullYear()} KGT Solutions. Your data trains only your own bots.</p>
        <Link href="/admin/login" className="hover:text-fg-2">Staff</Link>
      </div>
    </footer>
  );
}
