import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, ButtonLink, Card, CardHeader, EmptyState, Segmented, Skeleton, Spinner, cx } from '../ui';
import { useToast } from '../ui/toast';
import { IconChevronDown, IconInbox, IconMail } from '../ui/icons';

// Visitors who left an email in a bot conversation (services/leads.js on the
// API), newest first. Each card shows the AI summary's one-line intent; open
// it for the full summary and the conversation itself. While any summary is
// still being written, the list refreshes itself every few seconds. The bot
// and status filters are applied by the API (GET /leads?botType=&status=).

const BOTS = {
  sales: { label: 'Sales bot', tone: 'cyan' },
  support: { label: 'Support bot', tone: 'violet' }
};
const STATUSES = {
  NEW: { label: 'New', tone: 'warning' },
  CONTACTED: { label: 'Contacted', tone: 'success' }
};
const BOT_FILTERS = [{ value: 'all', label: 'All bots' }, { value: 'sales', label: 'Sales' }, { value: 'support', label: 'Support' }];
const STATUS_FILTERS = [{ value: 'all', label: 'All' }, { value: 'NEW', label: 'New' }, { value: 'CONTACTED', label: 'Contacted' }];
const POLL_MS = 8000;

// "Intent: ..." is the summary's first line (the prompt asks for it); fall
// back to the first line of whatever the model wrote.
function intentLine(summary) {
  const lines = String(summary || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const intent = lines.find((l) => /^intent:/i.test(l)) || lines[0] || '';
  return intent.replace(/^intent:\s*/i, '');
}

function SummaryPreview({ lead }) {
  if (lead.summaryStatus === 'pending') {
    return <p className="flex items-center gap-2 text-[13px] text-fg-3"><Spinner className="h-3.5 w-3.5" /> Writing the summary…</p>;
  }
  if (lead.summaryStatus === 'failed' || !lead.chatSummary) {
    return <p className="text-[13px] text-fg-3">No summary for this one — open it to read the conversation.</p>;
  }
  return <p className="text-[13px] leading-relaxed text-fg-2">{intentLine(lead.chatSummary)}</p>;
}

function Transcript({ messages }) {
  if (!messages?.length) return <p className="text-[13px] text-fg-3">The conversation isn't available.</p>;
  return (
    <ol className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
      {messages.map((m, i) => (
        <li key={i} className={cx('max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-[13px] leading-relaxed',
          m.role === 'user' ? 'self-end bg-cyan-400/10 text-fg' : 'self-start bg-white/[0.04] text-fg-2')}>
          <span className="mb-0.5 block text-[10.5px] font-medium uppercase tracking-wide text-fg-3">
            {m.role === 'user' ? 'Visitor' : 'Assistant'}
          </span>
          {m.content}
        </li>
      ))}
    </ol>
  );
}

function LeadCard({ lead, onStatus, busy }) {
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
        <div className="grid gap-5 border-t border-white/[0.06] p-4 lg:grid-cols-2">
          <section>
            <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-3">AI summary</h4>
            {lead.chatSummary
              ? <p className="whitespace-pre-line text-[13px] leading-relaxed text-fg-2">{lead.chatSummary}</p>
              : <SummaryPreview lead={lead} />}
            {lead.confirmationSentAt && (
              <p className="mt-3 text-xs text-fg-3">Confirmation email sent {new Date(lead.confirmationSentAt).toLocaleString()}</p>
            )}
          </section>
          <section>
            <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-fg-3">Conversation</h4>
            <Transcript messages={lead.fullTranscript} />
          </section>
        </div>
      )}
    </li>
  );
}

export default function LeadsPanel({ ws }) {
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

  const counts = data?.counts;
  const label = (opt, n) => (counts ? `${opt.label} (${n})` : opt.label);
  const botOptions = BOT_FILTERS.map((o) => ({ ...o, label: label(o, o.value === 'all' ? counts?.total : counts?.[o.value]) }));
  const statusOptions = STATUS_FILTERS.map((o) => ({ ...o, label: label(o, o.value === 'all' ? counts?.total : counts?.[o.value]) }));
  const leads = data?.leads;

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
            {leads.map((lead) => <LeadCard key={lead.id} lead={lead} onStatus={setStatus} busy={busyId === lead.id} />)}
          </ul>
        )}
      </div>
    </Card>
  );
}
