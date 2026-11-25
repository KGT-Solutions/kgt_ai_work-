import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, EmptyState, Segmented, Skeleton } from '../ui';
import { useToast } from '../ui/toast';
import { IconAlert, IconArrowRight } from '../ui/icons';
import { BOTS } from './ConversationParts';
import { SessionDrawer, shortId, visitorLabel } from './SessionsPanel';

// Improvements: the conversations where a bot genuinely missed (GET
// /improvements): a reply under 25% matching confidence
// (IMPROVEMENT_CONFIDENCE_BELOW on the API), or one where it gave no
// knowledge-base answer at all. Correct answers, which normally score 33-50%,
// stay out. Both bots unless filtered. Each entry lists the misses with the
// question that caused them, so the team can see which topics the documents
// don't cover yet and add them. Click an entry for the full session.

const BOT_FILTERS = [{ value: 'all', label: 'All bots' }, { value: 'sales', label: 'Sales' }, { value: 'support', label: 'Support' }];

// TEMP PREVIEW DATA — shown only when the API returns no improvements, so the
// empty page can be reviewed with content. Session ids match SessionsPanel's
// DEMO_SESSIONS, so "Open session" opens the working demo drawer. Remove this
// block (and the `usingDemo` fallback below) once real data exists.
const DEMO_IMPROVEMENT_SESSIONS = [
  {
    id: 'demo-sess-a4', botType: 'support', externalUserId: 'visitor-5521', leads: [],
    lastWeakAt: '2026-11-19T08:47:00Z', lowest: 0.18, weakAnswers: 2,
    weak: [
      { id: 'w-a4-1', question: 'Where is our patient data stored?', answer: 'I don’t have that detail documented yet — I’ll pass this to our team.', answered: false, confidence: 0.18, botType: 'support', at: '2026-11-19T08:46:00Z' },
      { id: 'w-a4-2', question: 'Are you HIPAA compliant?', answer: 'I’m not certain from the documents I have.', answered: true, confidence: 0.24, botType: 'support', at: '2026-11-19T08:47:00Z' }
    ]
  },
  {
    id: 'demo-sess-a6', botType: 'support', externalUserId: 'visitor-3310', leads: [],
    lastWeakAt: '2026-11-22T14:03:00Z', lowest: 0.22, weakAnswers: 1,
    weak: [
      { id: 'w-a6-1', question: 'What are your success rates for women over 40?', answer: 'I don’t have age-specific figures in the documents — please check with the clinic.', answered: true, confidence: 0.22, botType: 'support', at: '2026-11-22T14:03:00Z' }
    ]
  },
  {
    id: 'demo-sess-a3', botType: 'sales', externalUserId: 'visitor-8842', leads: [],
    lastWeakAt: '2026-11-22T13:05:00Z', lowest: 0.26, weakAnswers: 2,
    weak: [
      { id: 'w-a3-1', question: 'Do you offer EMI or instalment plans?', answer: 'I couldn’t find pricing-plan details in the documents.', answered: false, confidence: 0.26, botType: 'sales', at: '2026-11-22T13:04:00Z' },
      { id: 'w-a3-2', question: 'Is there a free trial?', answer: 'I’m not sure that’s documented.', answered: true, confidence: 0.29, botType: 'sales', at: '2026-11-22T13:05:00Z' }
    ]
  }
];
const DEMO_IMPROVEMENTS = { below: 0.25, totalSessions: 3, totalWeakAnswers: 5, sessions: DEMO_IMPROVEMENT_SESSIONS, nextPage: null };

const pct = (c) => `${Math.round(c * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Under the support gate (30%) the bot refused to answer at all.
const scoreTone = (c) => (c < 0.3 ? 'danger' : 'warning');

function WeakAnswer({ item }) {
  const bot = BOTS[item.botType];
  return (
    <li className="rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[13px] font-medium leading-relaxed text-fg">
          {item.question || <span className="font-normal italic text-fg-3">Question not recorded</span>}
        </p>
        <Badge tone={scoreTone(item.confidence)} className="shrink-0 tabular-nums">{pct(item.confidence)}</Badge>
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-fg-3">
        {!item.answered && <span className="mr-1 text-fg-2">No answer given ·</span>}
        {item.answer}
      </p>
      {bot && <p className="mt-1 text-[11px] text-fg-3">{bot.label} · {new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
    </li>
  );
}

function ImprovementCard({ session, below, onOpen }) {
  const bot = BOTS[session.botType];
  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <span className="font-mono text-xs text-fg-3">{shortId(session.id)}</span>
        <span className="truncate text-sm font-medium text-fg">{visitorLabel(session)}</span>
        {bot && <Badge tone={bot.tone}>{bot.label}</Badge>}
        <Badge tone={scoreTone(session.lowest)} dot>Lowest {pct(session.lowest)}</Badge>
        <span className="ml-auto text-xs text-fg-3">{new Date(session.lastWeakAt).toLocaleString()}</span>
      </div>
      <p className="px-4 pt-1 text-xs text-fg-3">
        {plural(session.weakAnswers, 'missed answer')} in this conversation
        {session.weak.length < session.weakAnswers && ` (latest ${session.weak.length} shown)`}
      </p>
      <ul className="space-y-2 p-4">
        {session.weak.map((w) => <WeakAnswer key={w.id} item={w} />)}
      </ul>
      <div className="flex justify-end border-t border-white/[0.06] px-4 py-2.5">
        <Button size="sm" variant="ghost" onClick={() => onOpen(session.id)}>
          Open session <IconArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </li>
  );
}

/** openId / onOpenChange: the open session, held by the parent (in the URL). */
export default function ImprovementsPanel({ ws, openId = null, onOpenChange }) {
  const toast = useToast();
  const [botFilter, setBotFilter] = useState('all');
  const [data, setData] = useState(null); // { below, totalSessions, totalWeakAnswers, sessions, nextPage }
  const [loadingMore, setLoadingMore] = useState(false);
  const latest = useRef(0);

  const load = useCallback(() => {
    const id = ++latest.current;
    return ws.listImprovements({ botType: botFilter }).then((res) => { if (id === latest.current) setData(res); });
  }, [ws, botFilter]);

  useEffect(() => {
    setData(null);
    load().catch((e) => toast.error(e.message));
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await ws.listImprovements({ botType: botFilter, page: data.nextPage });
      setData((d) => ({ ...res, sessions: [...d.sessions, ...res.sessions.filter((s) => !d.sessions.some((x) => x.id === s.id))] }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  // TEMP PREVIEW: when the API has no improvements, show DEMO data (filtered client-side).
  const usingDemo = !!data && data.sessions?.length === 0;
  const view = usingDemo
    ? { ...DEMO_IMPROVEMENTS, sessions: DEMO_IMPROVEMENTS.sessions.filter((s) => botFilter === 'all' || s.botType === botFilter) }
    : data;
  const below = view?.below ?? 0.25;
  const close = useCallback(() => onOpenChange?.(null), [onOpenChange]);

  return (
    <>
      <Card>
        <CardHeader icon={<IconAlert className="h-4 w-4" />} title="Answers to improve"
          description={data
            ? `${plural(view.totalSessions, 'conversation')} · ${plural(view.totalWeakAnswers, 'missed answer')} (no answer from your documents, or under ${pct(below)} confidence)`
            : 'Loading…'} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3">
          <Segmented label="Filter by bot" options={BOT_FILTERS} value={botFilter} onChange={setBotFilter} />
          <p className="text-xs text-fg-3">These questions point to topics your documents don't cover well yet.</p>
        </div>
        <div className="p-5">
          {!data ? <Skeleton className="h-32" /> : view.sessions.length === 0 ? (
            <EmptyState icon={<IconAlert className="h-5 w-5" />} title="Nothing to improve right now">
              When your Sales or Support bot can't answer from your documents, or answers with less than {pct(below)} confidence,
              the conversation shows up here with the question it struggled with.
            </EmptyState>
          ) : (
            <>
              <ul className="space-y-3">
                {view.sessions.map((s) => <ImprovementCard key={s.id} session={s} below={below} onOpen={(id) => onOpenChange?.(id)} />)}
              </ul>
              {view.nextPage != null && (
                <div className="mt-4 flex justify-center">
                  <Button variant="ghost" size="sm" loading={loadingMore} onClick={loadMore}>Load older conversations</Button>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
      {openId && <SessionDrawer ws={ws} sessionId={openId} onClose={close} onChanged={() => {}} />}
    </>
  );
}
