import { useEffect, useState } from 'react';
import { Badge, Card, CardHeader, EmptyState, Skeleton } from '../ui';
import { useToast } from '../ui/toast';
import { IconTicket } from '../ui/icons';

// Everything the bots handed to a person: questions they couldn't answer
// from the documents (the to-do list for missing content), visitors asking
// for a demo or a person, and emails left in the chat for a follow-up.
const KINDS = {
  unanswered: { label: 'Unanswered', tone: 'warning' },
  outage: { label: 'AI unavailable', tone: 'warning' },
  human_request: { label: 'Wants a person', tone: 'violet' },
  demo_request: { label: 'Demo request', tone: 'success' },
  contact_request: { label: 'Follow-up', tone: 'violet' }
};

export default function TicketsList({ ws }) {
  const toast = useToast();
  const [tickets, setTickets] = useState(null);
  useEffect(() => { ws.listTickets().then(setTickets).catch((e) => toast.error(e.message)); }, [ws]);

  return (
    <Card>
      <CardHeader title="Tickets and follow-ups"
        description="Questions the bots couldn't answer, plus visitors who asked for a demo or a person. Add missing information as a document and the bots will answer it next time." />
      <div className="p-5">
        {!tickets ? <Skeleton className="h-32" /> : tickets.length === 0 ? (
          <EmptyState icon={<IconTicket className="h-5 w-5" />} title="No tickets">Every question so far was answered from your documents.</EmptyState>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {tickets.map((t) => {
              const kind = KINDS[t.kind] || KINDS.unanswered;
              return (
                <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm text-fg">{t.query}</p>
                    {t.contactEmail && (
                      <a href={`mailto:${t.contactEmail}`} className="text-xs text-cyan-300 underline-offset-2 hover:underline">
                        {t.contactEmail}
                      </a>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-fg-3">
                    <Badge tone={kind.tone}>{kind.label}</Badge>
                    {t.botType && <span className="capitalize">{t.botType} bot</span>}
                    {typeof t.confidence === 'number' && <span className="tabular-nums">{Math.round(t.confidence * 100)}% match</span>}
                    <Badge tone={t.status === 'open' ? 'warning' : 'neutral'}>{t.status}</Badge>
                    <span>{new Date(t.createdAt).toLocaleString()}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
