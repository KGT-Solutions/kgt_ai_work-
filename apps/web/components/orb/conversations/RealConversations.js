import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { clientWorkspace } from '../../../lib/api';
import ConversationList from './ConversationList';
import ConversationDetail from './ConversationDetail';

// Real mode for the Conversations page: the left list + right detail wired to
// the Sessions API (ws.listSessions → GET /sessions, ws.getSession →
// GET /sessions/:id). React Query handles caching, cursor paging and the
// pending-summary polling. The mock-only parts of the design (per-message
// source, annotation boxes, "correct this answer", Booked/Ticket/Person pills,
// language/path/cost meta) have no backing API — see docs/ORB_NON_API_DATA.md —
// so they are simply left out here.

const botLabel = (b) => (b === 'sales' ? 'Sales bot' : b === 'support' ? 'Support bot' : 'Bot');
const plural = (n) => `${n} ${n === 1 ? 'message' : 'messages'}`;

const fmtTime = (iso) => {
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase(); } catch { return ''; }
};
const fmtDateTime = (iso) => {
  try { return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
};

// The AI summary's first line is "Intent: …" (services/leads.js); fall back to
// the first non-empty line.
const intentLine = (summary) => {
  const lines = String(summary || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const intent = lines.find((l) => /^intent:/i.test(l)) || lines[0] || '';
  return intent.replace(/^intent:\s*/i, '');
};

const visitorLabel = (s) => s?.leads?.[0]?.email || s?.externalUserId || 'Anonymous visitor';

// Only lead status is available; the other pill types (Booked/Ticket/Person)
// have no API, so they stay in Dummy mode.
const leadPills = (leads) => {
  if (!leads?.length) return [];
  const l = leads[0];
  return l.status === 'CONTACTED' ? [{ label: 'Lead · Contacted', tone: 'tint' }] : [{ label: 'New lead', tone: 'yellow' }];
};

export default function RealConversations({ botType = 'all', className = '' }) {
  const ws = useMemo(() => clientWorkspace(), []);
  const [selectedId, setSelectedId] = useState(null);

  // List — cursor paging; refetch while any summary is still being written.
  const list = useInfiniteQuery({
    queryKey: ['orb-sessions', botType],
    queryFn: ({ pageParam }) => ws.listSessions({ botType, cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: (query) => {
      const pages = query.state.data?.pages;
      const pending = pages?.some((p) => p.sessions?.some((s) => s.summaryStatus === 'pending'));
      return pending ? 8000 : false;
    }
  });

  const sessions = useMemo(() => list.data?.pages.flatMap((p) => p.sessions) ?? [], [list.data]);

  // Keep a valid selection: default to the first session once loaded, and reset
  // when the bot filter changes the set.
  useEffect(() => {
    if (!sessions.length) { setSelectedId(null); return; }
    if (!sessions.some((s) => s.id === selectedId)) setSelectedId(sessions[0].id);
  }, [sessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selected conversation — poll while its summary is still being written.
  const detail = useQuery({
    queryKey: ['orb-session', selectedId],
    queryFn: () => ws.getSession(selectedId),
    enabled: !!selectedId,
    refetchInterval: (query) => (query.state.data?.summaryStatus === 'pending' ? 4000 : false)
  });

  const items = sessions.map((s) => ({
    id: s.id,
    name: visitorLabel(s),
    time: fmtTime(s.lastMessageAt || s.startedAt),
    text: s.summaryStatus === 'pending' ? 'Summary being written…' : (intentLine(s.summary) || 'No summary yet'),
    meta: `${botLabel(s.botType)} · ${plural(s.messageCount)}`,
    pills: leadPills(s.leads)
  }));

  const listHeader = list.isLoading ? 'Loading…'
    : list.isError ? 'Could not load conversations'
    : `${sessions.length}${list.hasNextPage ? '+' : ''} conversations · newest first`;
  const footerNote = list.isFetchingNextPage ? 'Loading…' : `Showing ${sessions.length}`;

  const d = detail.data;
  const convo = d && {
    name: visitorLabel(d),
    pills: leadPills(d.leads),
    meta: `${fmtDateTime(d.startedAt)} · ${plural(d.messageCount)} · ${botLabel(d.botType)}`,
    summary: d.summary || '',
    summaryMeta: d.summarizedAt ? `written ${fmtDateTime(d.summarizedAt)}` : (d.summaryStatus === 'pending' ? 'being written…' : ''),
    messages: (d.messages || []).map((m) => (m.role === 'user'
      ? { role: 'visitor', text: m.content, time: fmtTime(m.createdAt) }
      : { role: 'orb', text: m.content })),
    footer: 'Phone numbers are masked here. Full details are in Leads & bookings, visible to your team only.'
  };

  return (
    <div className={`grid min-h-[560px] grid-cols-1 overflow-hidden rounded-2xl border border-orb-hairline bg-orb-white lg:h-[calc(100vh-232px)] lg:grid-cols-[380px_1fr] ${className}`}>
      <ConversationList
        header={listHeader}
        items={items}
        selectedId={selectedId}
        onSelect={setSelectedId}
        footerNote={footerNote}
        onLoadMore={list.hasNextPage ? () => list.fetchNextPage() : undefined}
        className="border-b border-orb-hairline lg:border-b-0 lg:border-r"
      />
      {detail.isLoading ? (
        <div className="flex items-center justify-center p-10 orb-body text-orb-secondary">Loading conversation…</div>
      ) : detail.isError ? (
        <div className="flex items-center justify-center p-10 orb-body text-orb-ink">{detail.error?.message || 'Could not load this conversation.'}</div>
      ) : convo ? (
        <ConversationDetail convo={convo} />
      ) : (
        <div className="flex items-center justify-center p-10 orb-body text-orb-secondary">
          {list.isLoading ? 'Loading…' : 'No conversations yet.'}
        </div>
      )}
    </div>
  );
}
