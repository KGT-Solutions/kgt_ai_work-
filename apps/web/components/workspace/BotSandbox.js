import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Segmented, Spinner, cx } from '../ui';
import { IconBolt, IconSend, IconShield, IconSpark } from '../ui/icons';

// Side-by-side sandbox: one composer, the Support Bot and the Sales Bot
// answering in their own panes. Runs through ws.chat, i.e. the signed-in
// session — same engine, knowledge and rate limit as the embedded widget.
//
// Starter chips come from ws.getFaqs(): questions an LLM wrote from this
// tenant's own documents after signup or an import. Until those are ready
// (or if generation failed) each pane shows the generic starters below.

const BOTS = [
  { id: 'support', name: 'Support Bot', icon: IconShield, tone: 'cyan', blurb: 'Grounded, factual answers. Hands off when unsure.',
    faqKey: 'supportFaqs', starters: ['How do I get started?', 'What is your refund policy?'] },
  { id: 'sales', name: 'Sales Bot', icon: IconBolt, tone: 'violet', blurb: 'Persuasive, benefit-led, ends with a next step.',
    faqKey: 'salesFaqs', starters: ['Why should we choose you?', 'How does your pricing work?'] }
];

const FAQ_POLL_MS = 4000;
const FAQ_POLL_MAX = 30; // ~2 minutes, then settle for the generic starters

// Loads the tenant's starter FAQs, polling while the API reports "pending".
function useStarterFaqs(ws) {
  const [faqs, setFaqs] = useState(null);
  const [polls, setPolls] = useState(0);

  const load = useCallback(async () => {
    try {
      setFaqs(await ws.getFaqs());
    } catch {
      setFaqs({ status: 'failed', supportFaqs: [], salesFaqs: [] }); // generic starters still work
    }
  }, [ws]);

  useEffect(() => { if (ws) { setPolls(0); load(); } }, [ws, load]);

  useEffect(() => {
    if (faqs?.status !== 'pending' || polls >= FAQ_POLL_MAX) return undefined;
    const t = setTimeout(() => { setPolls((n) => n + 1); load(); }, FAQ_POLL_MS);
    return () => clearTimeout(t);
  }, [faqs, polls, load]);

  const regenerate = async () => {
    try {
      await ws.regenerateFaqs();
      setPolls(0);
      setFaqs((f) => ({ ...(f || { supportFaqs: [], salesFaqs: [] }), status: 'pending' }));
    } catch (err) {
      setFaqs((f) => ({ ...(f || { supportFaqs: [], salesFaqs: [] }), notice: err.message }));
    }
  };

  const generating = faqs?.status === 'pending' && polls < FAQ_POLL_MAX;
  return { faqs, generating, regenerate };
}

export default function BotSandbox({ ws, tenant }) {
  const [target, setTarget] = useState('both');
  const [threads, setThreads] = useState({ support: [], sales: [] });
  const [sessions, setSessions] = useState({});
  const [pending, setPending] = useState({ support: false, sales: false });
  const [input, setInput] = useState('');
  const inputRef = useRef(null);
  const { faqs, generating, regenerate } = useStarterFaqs(ws);

  const ask = async (bot, query) => {
    setThreads((t) => ({ ...t, [bot]: [...t[bot], { role: 'user', text: query }] }));
    setPending((p) => ({ ...p, [bot]: true }));
    try {
      const data = await ws.chat({ query, botType: bot, sessionId: sessions[bot] });
      setSessions((s) => ({ ...s, [bot]: data.sessionId }));
      setThreads((t) => ({ ...t, [bot]: [...t[bot], { role: 'bot', text: data.answer, meta: data }] }));
    } catch (err) {
      setThreads((t) => ({ ...t, [bot]: [...t[bot], { role: 'bot', text: err.message, error: true }] }));
    } finally {
      setPending((p) => ({ ...p, [bot]: false }));
    }
  };

  const send = (text) => {
    const query = String(text ?? input).trim();
    if (!query) return;
    setInput('');
    const bots = target === 'both' ? ['support', 'sales'] : [target];
    bots.forEach((b) => ask(b, query));
    inputRef.current?.focus();
  };

  const busy = (target === 'both' ? pending.support || pending.sales : pending[target]);
  const reset = () => { setThreads({ support: [], sales: [] }); setSessions({}); };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {BOTS.map((bot) => {
          const tailored = faqs?.[bot.faqKey] || [];
          return (
            <BotPane key={bot.id} bot={bot} tenant={tenant} thread={threads[bot.id]} pending={pending[bot.id]}
              starters={tailored.length ? tailored : bot.starters} tailored={tailored.length > 0} generating={generating}
              dimmed={target !== 'both' && target !== bot.id} onStarter={(s) => { setTarget(bot.id); ask(bot.id, s); }} />
          );
        })}
      </div>

      <Card className="p-3">
        <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Segmented label="Send to" value={target} onChange={setTarget}
            options={[{ value: 'both', label: 'Both' }, { value: 'support', label: 'Support' }, { value: 'sales', label: 'Sales' }]} />
          <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} aria-label="Message"
            placeholder={target === 'both' ? 'Ask both bots the same question…' : `Ask the ${target === 'support' ? 'Support' : 'Sales'} Bot…`}
            className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-panel-2/80 px-3.5 text-sm text-fg placeholder:text-fg-3 focus:border-cyan-400/60 focus:outline-none focus:ring-4 focus:ring-cyan-400/10" />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={!input.trim() || busy}><IconSend className="h-4 w-4" />Send</Button>
            <Button onClick={reset} variant="ghost" disabled={!threads.support.length && !threads.sales.length}>Clear</Button>
          </div>
        </form>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11.5px] text-fg-3">
          <span>{faqs?.notice || (generating
            ? 'Writing suggested questions from your content…'
            : faqs?.status === 'ready' ? 'Suggested questions are written from your documents.' : 'Showing general starter questions.')}</span>
          <button type="button" onClick={regenerate} disabled={generating}
            className="rounded px-1 text-fg-2 underline-offset-2 transition hover:text-fg hover:underline disabled:cursor-not-allowed disabled:opacity-45">
            Refresh suggestions
          </button>
        </div>
      </Card>
    </div>
  );
}

function BotPane({ bot, tenant, thread, pending, starters, tailored, generating, dimmed, onStarter }) {
  const scrollRef = useRef(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }); }, [thread, pending]);
  const Icon = bot.icon;
  const accent = bot.tone === 'cyan' ? 'from-cyan-400/20' : 'from-violet-400/20';

  return (
    <Card className={cx('flex h-[480px] flex-col overflow-hidden transition', dimmed && 'opacity-60')}>
      <div className={cx('flex items-center justify-between gap-3 border-b border-white/[0.06] bg-gradient-to-r to-transparent px-4 py-3', accent)}>
        <div className="flex items-center gap-2.5">
          <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-obsidian/60', bot.tone === 'cyan' ? 'text-cyan-300' : 'text-violet-300')}>
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">{bot.name}</p>
            <p className="text-[11.5px] text-fg-3">{bot.blurb}</p>
          </div>
        </div>
        <Badge tone="success" dot>Live</Badge>
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4" aria-live="polite" aria-label={`${bot.name} conversation`}>
        {thread.length === 0 && !pending && (
          <div className="m-auto max-w-sm text-center">
            <p className="text-sm text-fg-2">Chat with {tenant.name}&apos;s {bot.name}.</p>
            {tailored && (
              <p className="mt-1 inline-flex items-center gap-1 text-[11.5px] text-fg-3">
                <IconSpark className="h-3.5 w-3.5" />Questions your customers are likely to ask
              </p>
            )}
            {!tailored && generating && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-[11.5px] text-fg-3">
                <Spinner className="h-3.5 w-3.5" />Tailoring questions to your content…
              </p>
            )}
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {starters.map((s) => (
                <button key={s} type="button" onClick={() => onStarter(s)}
                  className={cx('rounded-full border px-3 py-1.5 text-left text-xs transition hover:text-fg',
                    tailored
                      ? (bot.tone === 'cyan' ? 'border-cyan-400/25 bg-cyan-400/[0.06] text-fg hover:border-cyan-400/50' : 'border-violet-400/25 bg-violet-400/[0.06] text-fg hover:border-violet-400/50')
                      : 'border-white/10 bg-white/[0.03] text-fg-2 hover:border-white/20')}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {thread.map((m, i) => (
          m.role === 'user' ? (
            <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-white/[0.08] px-3.5 py-2 text-sm text-fg">{m.text}</div>
          ) : (
            <div key={i} className="max-w-[92%]">
              <div className={cx('whitespace-pre-wrap rounded-2xl rounded-bl-md border px-3.5 py-2.5 text-sm leading-relaxed',
                m.error ? 'border-rose-400/25 bg-rose-500/10 text-rose-100' : 'border-white/[0.08] bg-panel-2/80 text-fg')}>
                {m.text}
              </div>
              {m.meta && <AnswerMeta meta={m.meta} />}
            </div>
          )
        ))}
        {pending && (
          <div className="flex w-fit gap-1 rounded-2xl rounded-bl-md border border-white/[0.08] bg-panel-2/80 px-3.5 py-3" aria-label="Thinking">
            {[0, 150, 300].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-3" style={{ animationDelay: `${d}ms` }} />)}
          </div>
        )}
      </div>
    </Card>
  );
}

// How the engine produced the answer: grounded source, a handoff, an outage,
// or a repeat question served from the answer cache (no model call, no cost).
function AnswerMeta({ meta }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5 pl-1">
      {meta.cached && <Badge tone="success">Instant · from cache, $0</Badge>}
      {meta.degraded && <Badge tone="warning">AI unavailable · logged as ticket</Badge>}
      {!meta.degraded && typeof meta.confidence === 'number' && <Badge tone="warning">Handed off · {Math.round(meta.confidence * 100)}% match</Badge>}
      {meta.sourceSection && <Badge>Source · {meta.sourceSection}</Badge>}
      {(meta.keyBenefitsHighlighted || []).map((b) => <Badge key={b} tone="violet">{b}</Badge>)}
    </div>
  );
}
