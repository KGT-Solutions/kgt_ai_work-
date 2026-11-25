import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, Segmented, Skeleton, Spinner, cx } from '../ui';
import { useToast } from '../ui/toast';
import { IconChevronDown, IconInbox, IconMail } from '../ui/icons';
import { BOTS, SummaryText, TranscriptToggle, intentLine } from './ConversationParts';

// Visitors who left an email in a bot conversation (services/leads.js on the
// API), newest first. Each card shows the AI summary's one-line intent; open
// it for the full summary and the conversation itself. While any summary is
// still being written, the list refreshes itself every few seconds. The bot
// and status filters are applied by the API (GET /leads?botType=&status=).

const STATUSES = {
  NEW: { label: 'New', tone: 'warning' },
  CONTACTED: { label: 'Contacted', tone: 'success' }
};
const BOT_FILTERS = [{ value: 'all', label: 'All bots' }, { value: 'sales', label: 'Sales' }, { value: 'support', label: 'Support' }];
const STATUS_FILTERS = [{ value: 'all', label: 'All' }, { value: 'NEW', label: 'New' }, { value: 'CONTACTED', label: 'Contacted' }];
const POLL_MS = 8000;

// TEMP PREVIEW DATA — shown only when the API returns no leads, so the empty
// page can be reviewed with content. Bot/status filters are applied client-side
// to this set. Remove this block (and the `usingDemo` fallback below) once real
// leads exist.
const DEMO_LEADS = [
  {
    id: 'demo-1', email: 'priya.menon@sunrisefertility.in', botType: 'sales', status: 'NEW',
    summaryStatus: 'done', createdAt: '2026-11-23T09:12:00Z', sessionId: 'demo1sessabc12345',
    chatSummary: 'Intent: Wants a demo of the sales assistant for their fertility clinic.\nKey questions: Pricing for the annual plan, whether it supports Hindi.\nOutcome: Shared email, asked for a callback this week.\nFollow-up actions: Book a demo and confirm multilingual support.',
    fullTranscript: [
      { role: 'user', content: 'Hi, do you offer a demo of your sales chatbot?', createdAt: '2026-11-23T09:10:00Z' },
      { role: 'assistant', content: 'Yes! I can set that up. Could you share your email so our team can reach out?', createdAt: '2026-11-23T09:11:00Z', confidence: 0.86 },
      { role: 'user', content: 'priya.menon@sunrisefertility.in — also, does it support Hindi?', createdAt: '2026-11-23T09:11:40Z' },
      { role: 'assistant', content: 'Thanks Priya! Yes, it supports Hindi. Someone will email you to schedule the demo.', createdAt: '2026-11-23T09:12:00Z', confidence: 0.78 }
    ]
  },
  {
    id: 'demo-2', email: 'rohit@acmehealth.com', botType: 'support', status: 'CONTACTED',
    summaryStatus: 'done', createdAt: '2026-11-22T17:40:00Z', sessionId: 'demo2sessdef67890',
    confirmationSentAt: '2026-11-22T17:41:00Z',
    chatSummary: 'Intent: Needs help resetting a patient portal password.\nKey questions: Where to reset, how long the link lasts.\nOutcome: Guided to the reset page; visitor confirmed it worked.\nFollow-up actions: None — resolved.',
    fullTranscript: [
      { role: 'user', content: 'I can’t log in to the patient portal.', createdAt: '2026-11-22T17:38:00Z' },
      { role: 'assistant', content: 'You can reset your password at /portal/reset — the link is valid for 30 minutes.', createdAt: '2026-11-22T17:39:00Z', confidence: 0.41 },
      { role: 'user', content: 'Got it, that worked. My email is rohit@acmehealth.com if you need it.', createdAt: '2026-11-22T17:40:00Z' }
    ]
  },
  {
    id: 'demo-3', email: 'ananya.k@gmail.com', botType: 'sales', status: 'NEW',
    summaryStatus: 'done', createdAt: '2026-11-22T13:05:00Z', sessionId: 'demo3sessghi13579',
    chatSummary: 'Intent: Comparing plans for a small clinic (2 doctors).\nKey questions: Difference between Starter and Pro, overage charges.\nOutcome: Leaning towards Pro, wants a written quote.\nFollow-up actions: Send a quote for the Pro plan.',
    fullTranscript: [
      { role: 'user', content: 'What’s the difference between Starter and Pro?', createdAt: '2026-11-22T13:02:00Z' },
      { role: 'assistant', content: 'Pro adds the sales bot and higher message limits. Want me to send a quote?', createdAt: '2026-11-22T13:03:00Z', confidence: 0.69 },
      { role: 'user', content: 'Yes please, ananya.k@gmail.com', createdAt: '2026-11-22T13:05:00Z' }
    ]
  },
  {
    id: 'demo-4', email: 'david.ops@northclinic.co', botType: 'support', status: 'NEW',
    summaryStatus: 'pending', createdAt: '2026-11-21T19:20:00Z', sessionId: 'demo4sessjkl24680',
    chatSummary: null,
    fullTranscript: [
      { role: 'user', content: 'Do you integrate with our existing CRM?', createdAt: '2026-11-21T19:18:00Z' },
      { role: 'assistant', content: 'We support webhooks and a REST API. Share your email and I’ll have someone confirm specifics.', createdAt: '2026-11-21T19:19:00Z', confidence: 0.2 },
      { role: 'user', content: 'david.ops@northclinic.co', createdAt: '2026-11-21T19:20:00Z' }
    ]
  },
  {
    id: 'demo-5', email: 'meera@brightsmiles.in', botType: 'sales', status: 'CONTACTED',
    summaryStatus: 'done', createdAt: '2026-11-20T11:02:00Z', sessionId: 'demo5sessmno11223',
    chatSummary: 'Intent: Interested in adding Orb to a dental chain (4 branches).\nKey questions: Per-branch pricing, onboarding time.\nOutcome: Asked sales to call; preferred time mornings.\nFollow-up actions: Call Meera in the morning with branch pricing.',
    fullTranscript: [
      { role: 'user', content: 'We have 4 branches — how does pricing work?', createdAt: '2026-11-20T11:00:00Z' },
      { role: 'assistant', content: 'Pricing is per branch with a discount at 3+. I can have sales call you — best time?', createdAt: '2026-11-20T11:01:00Z', confidence: 0.72 },
      { role: 'user', content: 'Mornings. meera@brightsmiles.in', createdAt: '2026-11-20T11:02:00Z' }
    ]
  },
  {
    id: 'demo-6', email: 'sam.lee@healthfirst.org', botType: 'support', status: 'NEW',
    summaryStatus: 'done', createdAt: '2026-11-19T08:47:00Z', sessionId: 'demo6disesspqr33445',
    chatSummary: 'Intent: Asking whether data is stored in India.\nKey questions: Data residency, HIPAA-style compliance.\nOutcome: Wanted a document; none was available, handed to a person.\nFollow-up actions: Send the data-residency / compliance overview.',
    fullTranscript: [
      { role: 'user', content: 'Where is our patient data stored?', createdAt: '2026-11-19T08:45:00Z' },
      { role: 'assistant', content: 'I don’t have that detail documented yet — I’ll pass this to our team. What’s your email?', createdAt: '2026-11-19T08:46:00Z', confidence: 0.18 },
      { role: 'user', content: 'sam.lee@healthfirst.org', createdAt: '2026-11-19T08:47:00Z' }
    ]
  }
];
const DEMO_COUNTS = { total: 6, NEW: 4, CONTACTED: 2, sales: 3, support: 3 };

function SummaryPreview({ lead }) {
  if (lead.summaryStatus === 'pending') {
    return <p className="flex items-center gap-2 text-[13px] text-fg-3"><Spinner className="h-3.5 w-3.5" /> Writing the summary…</p>;
  }
  if (lead.summaryStatus === 'failed' || !lead.chatSummary) {
    return <p className="text-[13px] text-fg-3">No summary for this one — open it to read the conversation.</p>;
  }
  return <p className="text-[13px] leading-relaxed text-fg-2">{intentLine(lead.chatSummary)}</p>;
}

function LeadCard({ lead, onStatus, busy, onOpenSession }) {
  const [open, setOpen] = useState(false);
  const bot = BOTS[lead.botType] || BOTS.support;
  const status = STATUSES[lead.status] || STATUSES.NEW;
  const contacted = lead.status === 'CONTACTED';

  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <a href={`mailto:${lead.email}`} className="truncate text-sm font-medium text-fg underline-offset-2 hover:underline">{lead.email}</a>
            <Badge tone={bot.tone}>{bot.label}</Badge>
            <Badge tone={status.tone} dot={!contacted}>{status.label}</Badge>
          </div>
          <SummaryPreview lead={lead} />
          <p className="text-xs text-fg-3">{new Date(lead.createdAt).toLocaleString()}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <ButtonLink href={`mailto:${lead.email}`} size="sm"><IconMail className="h-4 w-4" /> Email</ButtonLink>
          <Button size="sm" variant={contacted ? 'ghost' : 'secondary'} loading={busy}
            onClick={() => onStatus(lead, contacted ? 'NEW' : 'CONTACTED')}>
            {contacted ? 'Mark as new' : 'Mark contacted'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Hide' : 'Details'}
            <IconChevronDown className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-white/[0.06] p-4">
          <section>
            <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-3">AI summary</h4>
            {lead.chatSummary ? <SummaryText summary={lead.chatSummary} /> : <SummaryPreview lead={lead} />}
            {lead.confirmationSentAt && (
              <p className="mt-3 text-xs text-fg-3">Confirmation email sent {new Date(lead.confirmationSentAt).toLocaleString()}</p>
            )}
            {lead.sessionId && onOpenSession && (
              <button type="button" onClick={() => onOpenSession(lead.sessionId)}
                className="mt-3 text-xs font-medium text-brand-300 underline-offset-2 hover:underline">
                Open session #{lead.sessionId.slice(0, 8)}
              </button>
            )}
          </section>
          <TranscriptToggle messages={lead.fullTranscript} showMeta={false} />
        </div>
      )}
    </li>
  );
}

// onOpenSession(sessionId): optional, shows the lead's conversation in the Sessions view.
export default function LeadsPanel({ ws, onOpenSession }) {
  const toast = useToast();
  const [data, setData] = useState(null); // { leads, counts } for the current filters
  const [botFilter, setBotFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const latest = useRef(0);

  // Filters are applied by the API. Only the newest request's answer is
  // kept, so clicking through filters quickly never shows a stale list.
  const load = useCallback(() => {
    const id = ++latest.current;
    return ws.listLeads({ botType: botFilter, status: statusFilter }).then((res) => {
      if (id === latest.current) setData(res);
    });
  }, [ws, botFilter, statusFilter]);

  useEffect(() => {
    setData((d) => (d ? { ...d, leads: null } : d)); // keep counts, show the list as loading
    load().catch((e) => toast.error(e.message));
  }, [load]);

  // Summaries are written in the background; refresh until they're all in.
  const pending = !!data?.leads?.some((l) => l.summaryStatus === 'pending');
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => { load().catch(() => {}); }, POLL_MS);
    return () => clearInterval(timer);
  }, [pending, load]);

  const setStatus = async (lead, status) => {
    setBusyId(lead.id);
    try {
      await ws.updateLeadStatus(lead.id, status);
      await load(); // counts change, and the lead may no longer match the status filter
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  // TEMP PREVIEW: when the API has no leads, show DEMO_LEADS (filtered client-side).
  const usingDemo = !!data && data.counts?.total === 0 && data.leads != null;
  const counts = usingDemo ? DEMO_COUNTS : data?.counts;
  const leads = usingDemo
    ? DEMO_LEADS.filter((l) => (botFilter === 'all' || l.botType === botFilter) && (statusFilter === 'all' || l.status === statusFilter))
    : data?.leads;

  const label = (opt, n) => (counts ? `${opt.label} (${n})` : opt.label);
  const botOptions = BOT_FILTERS.map((o) => ({ ...o, label: label(o, o.value === 'all' ? counts?.total : counts?.[o.value]) }));
  const statusOptions = STATUS_FILTERS.map((o) => ({ ...o, label: label(o, o.value === 'all' ? counts?.total : counts?.[o.value]) }));

  return (
    <Card>
      <CardHeader icon={<IconInbox className="h-4 w-4" />} title="Captured leads"
        description={counts ? `${counts.total} total · ${counts.NEW} waiting for follow-up` : 'Loading…'} />
      <div className="flex flex-wrap gap-2 border-b border-white/[0.06] px-5 py-3">
        <Segmented label="Filter by bot" options={botOptions} value={botFilter} onChange={setBotFilter} />
        <Segmented label="Filter by status" options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
      </div>
      <div className="p-5">
        {!leads ? <Skeleton className="h-32" /> : counts.total === 0 ? (
          <EmptyState icon={<IconInbox className="h-5 w-5" />} title="No leads yet">
            When a visitor shares their email with your Sales or Support bot, they'll show up here with a summary of the chat.
          </EmptyState>
        ) : leads.length === 0 ? (
          <EmptyState icon={<IconInbox className="h-5 w-5" />} title="Nothing matches these filters" />
        ) : (
          <ul className="space-y-3">
            {leads.map((lead) => (
              <LeadCard key={lead.id} lead={lead} onStatus={setStatus} busy={busyId === lead.id} onOpenSession={onOpenSession} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
