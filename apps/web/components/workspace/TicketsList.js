import { useEffect, useState } from 'react';
import { Badge, Card, CardHeader, EmptyState, Skeleton } from '../ui';
import { useToast } from '../ui/toast';
import { IconTicket } from '../ui/icons';

// Questions the bots couldn't answer from the knowledge base (or that came in
// while the AI provider was down) — the to-do list for missing documents.
export default function TicketsList({ ws }) {
  const toast = useToast();
  const [tickets, setTickets] = useState(null);
  useEffect(() => { ws.listTickets().then(setTickets).catch((e) => toast.error(e.message)); }, [ws]);

  return (
    <Card>
      <CardHeader title="Unanswered questions" description="Add the missing information as a document and the bots will answer it next time." />
      <div className="p-5">
        {!tickets ? <Skeleton className="h-32" /> : tickets.length === 0 ? (
          <EmptyState icon={<IconTicket className="h-5 w-5" />} title="No tickets">Every question so far was answered from your documents.</EmptyState>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {tickets.map((t) => (
              <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-fg">{t.query}</p>
                <div className="flex shrink-0 items-center gap-2 text-xs text-fg-3">
                  <span className="tabular-nums">{Math.round(t.confidence * 100)}% match</span>
                  <Badge tone={t.status === 'open' ? 'warning' : 'neutral'}>{t.status}</Badge>
                  <span>{new Date(t.createdAt).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
