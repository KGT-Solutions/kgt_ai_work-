import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, Segmented, Skeleton, Spinner, cx } from '../ui';
import { useToast } from '../ui/toast';
import { IconLayers, IconMail, IconSpark, IconX } from '../ui/icons';
import { BOTS, SummaryText, TranscriptToggle, intentLine, outcomeLine } from './ConversationParts';

// Session-wise history: every conversation with the tenant's bots, newest
// activity first, each with its AI summary (services/chatSessions.js on the
// API — written once a chat has been quiet for a couple of minutes, or when
// the visitor leaves the page). Click one for the structured summary and its
// leads (which can be marked contacted there); the raw transcript stays
// folded away behind "View full transcript". While a summary is being
// written (or a chat is still fresh), the list refreshes itself.

const BOT_FILTERS = [{ value: 'all', label: 'All bots' }, { value: 'sales', label: 'Sales' }, { value: 'support', label: 'Support' }];
const POLL_MS = 15000;
const FRESH_MS = 5 * 60 * 1000; // a chat this recent may get its summary any moment

export const shortId = (id) => `#${String(id).slice(0, 8)}`;
const when = (s) => new Date(s.lastMessageAt || s.startedAt).toLocaleString();

export function visitorLabel(session) {
  if (session.leads?.length) return session.leads[0].email;
  if (session.externalUserId) return session.externalUserId;
  return 'Anonymous visitor';
}

function SummaryState({ session, compact = false }) {
  if (session.summaryStatus === 'pending') {
    return <p className="flex items-center gap-2 text-[13px] text-fg-3"><Spinner className="h-3.5 w-3.5" /> Writing the summary…</p>;
  }
  if (session.summary) {
    if (!compact) return <SummaryText summary={session.summary} />;
    const outcome = outcomeLine(session.summary);
    return (
      <div className="space-y-0.5">
        <p className="text-[13px] leading-relaxed text-fg-2">{intentLine(session.summary)}</p>
        {outcome && <p className="text-xs text-fg-3">Outcome: {outcome}</p>}
      </div>
    );
  }
  if (session.summaryStatus === 'failed') return <p className="text-[13px] text-fg-3">The summary couldn't be written — the transcript is still here.</p>;
  if (session.messageCount < 2) return <p className="text-[13px] text-fg-3">Too short to summarize.</p>;
  return <p className="text-[13px] text-fg-3">The summary is written once the chat goes quiet.</p>;
}

function LeadBadges({ leads }) {
  if (!leads?.length) return null;
  const waiting = leads.some((l) => l.status === 'NEW');
  return <Badge tone={waiting ? 'warning' : 'success'} dot={waiting}>{waiting ? 'Lead · New' : 'Lead · Contacted'}</Badge>;
}

function SessionRow({ session, onOpen }) {
  const bot = BOTS[session.botType];
  return (
    <li>
      <button type="button" onClick={() => onOpen(session.id)}
        className="group w-full rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left transition hover:border-white/[0.12] hover:bg-white/[0.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/40">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-fg-3">{shortId(session.id)}</span>
          <span className="truncate text-sm font-medium text-fg">{visitorLabel(session)}</span>
          {bot && <Badge tone={bot.tone}>{bot.label}</Badge>}
          <LeadBadges leads={session.leads} />
          <span className="ml-auto text-xs text-fg-3">{when(session)} · {session.messageCount} messages</span>
        </div>
        <div className="mt-2"><SummaryState session={session} compact /></div>
      </button>
    </li>
  );
}

/** Opens a session's summary, leads and (on request) transcript. Also used by the Improvements view. */
export function SessionDrawer({ ws, sessionId, onClose, onChanged }) {
  const toast = useToast();
  const [session, setSession] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null); // lead id or 'summary'

  const load = useCallback(() => ws.getSession(sessionId).then(setSession), [ws, sessionId]);

  useEffect(() => {
    setSession(null);
    setError('');
    load().catch((e) => setError(e.message));
  }, [load]);

  // A summary being (re)written: check back until it's in.
  useEffect(() => {
    if (session?.summaryStatus !== 'pending') return undefined;
    const timer = setInterval(() => { load().catch(() => {}); }, 4000);
    return () => clearInterval(timer);
  }, [session?.summaryStatus, load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setLeadStatus = async (lead, status) => {
    setBusy(lead.id);
    try {
      await ws.updateLeadStatus(lead.id, status);
      await load();
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const resummarize = async () => {
    setBusy('summary');
    try {
      await ws.summarizeSession(sessionId);
      setSession((s) => ({ ...s, summaryStatus: 'pending' }));
      onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  };

  const bot = BOTS[session?.botType];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Conversation">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside className="relative flex h-full w-full max-w-xl flex-col border-l border-white/[0.08] bg-panel shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-fg">Session <span className="font-mono">{shortId(sessionId)}</span></h3>
              {bot && <Badge tone={bot.tone}>{bot.label}</Badge>}
              {session?.endedAt && <Badge>Ended</Badge>}
            </div>
            {session && (
              <p className="text-xs text-fg-3">
                {visitorLabel(session)} · started {new Date(session.startedAt).toLocaleString()} · {session.messageCount} messages
              </p>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close"><IconX className="h-4 w-4" /></Button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {error ? <p className="text-[13px] text-rose-300">{error}</p> : !session ? <Skeleton className="h-64" /> : (
            <>
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="text-[11px] font-medium uppercase tracking-[0.1em] text-fg-3">AI summary</h4>
                  <Button size="sm" variant="ghost" loading={busy === 'summary'} disabled={session.summaryStatus === 'pending'} onClick={resummarize}>
                    <IconSpark className="h-4 w-4" /> {session.summary ? 'Rewrite' : 'Summarize now'}
                  </Button>
                </div>
                <SummaryState session={session} />
              </section>

              {session.leads.length > 0 && (
                <section>
                  <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-3">Lead</h4>
                  <ul className="space-y-2">
                    {session.leads.map((lead) => {
                      const contacted = lead.status === 'CONTACTED';
                      return (
                        <li key={lead.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                          <a href={`mailto:${lead.email}`} className="min-w-0 flex-1 truncate text-sm text-fg underline-offset-2 hover:underline">{lead.email}</a>
                          <Badge tone={contacted ? 'success' : 'warning'} dot={!contacted}>{contacted ? 'Contacted' : 'New'}</Badge>
                          <ButtonLink href={`mailto:${lead.email}`} size="sm"><IconMail className="h-4 w-4" /> Email</ButtonLink>
                          <Button size="sm" variant={contacted ? 'ghost' : 'secondary'} loading={busy === lead.id}
                            onClick={() => setLeadStatus(lead, contacted ? 'NEW' : 'CONTACTED')}>
                            {contacted ? 'Mark as new' : 'Mark contacted'}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              <TranscriptToggle messages={session.messages} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * openId / onOpenChange: the open session, held by the parent so the Leads
 * view can open one here (and the URL can carry it).
 */
export default function SessionsPanel({ ws, openId = null, onOpenChange }) {
  const toast = useToast();
  const [botFilter, setBotFilter] = useState('all');
  const [sessions, setSessions] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0);

  // The first page, for the current filter; only the newest request's answer is kept.
  const load = useCallback(() => {
    const id = ++latest.current;
    return ws.listSessions({ botType: botFilter }).then((res) => {
      if (id !== latest.current) return;
      setSessions(res.sessions);
      setNextCursor(res.nextCursor);
    });
  }, [ws, botFilter]);

  useEffect(() => {
    setSessions(null);
    load().catch((e) => toast.error(e.message));
  }, [load]);

  const waiting = !!sessions?.some((s) => s.summaryStatus === 'pending' ||
    (!s.summary && s.messageCount >= 2 && Date.now() - new Date(s.lastMessageAt || s.startedAt) < FRESH_MS));
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => { load().catch(() => {}); }, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await ws.listSessions({ botType: botFilter, cursor: nextCursor });
      setSessions((list) => [...list, ...res.sessions.filter((s) => !list.some((x) => x.id === s.id))]);
      setNextCursor(res.nextCursor);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  const open = (id) => onOpenChange?.(id);
  const close = useCallback(() => onOpenChange?.(null), [onOpenChange]);

  return (
    <>
      <Card>
        <CardHeader icon={<IconLayers className="h-4 w-4" />} title="Session history"
          description="Every conversation with your bots, with an AI summary of what the visitor wanted and how it ended." />
        <div className="flex flex-wrap gap-2 border-b border-white/[0.06] px-5 py-3">
          <Segmented label="Filter by bot" options={BOT_FILTERS} value={botFilter} onChange={setBotFilter} />
        </div>
        <div className="p-5">
          {!sessions ? <Skeleton className="h-32" /> : sessions.length === 0 ? (
            <EmptyState icon={<IconLayers className="h-5 w-5" />} title={botFilter === 'all' ? 'No conversations yet' : 'No conversations with this bot yet'}>
              Once visitors chat with your Sales or Support bot, each conversation shows up here with a summary.
            </EmptyState>
          ) : (
            <>
              <ul className="space-y-3">
                {sessions.map((s) => <SessionRow key={s.id} session={s} onOpen={open} />)}
              </ul>
              {nextCursor && (
                <div className={cx('mt-4 flex justify-center')}>
                  <Button variant="ghost" size="sm" loading={loadingMore} onClick={loadMore}>Load older conversations</Button>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
      {openId && <SessionDrawer ws={ws} sessionId={openId} onClose={close} onChanged={() => load().catch(() => {})} />}
    </>
  );
}
