import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Select, Skeleton, Textarea } from '../ui';
import { useToast } from '../ui/toast';
import { IconTicket } from '../ui/icons';
import { DOC_CATEGORIES } from '../../lib/documentCategories';

// Everything the bots handed to a person: questions they couldn't answer
// from the documents (the to-do list for missing content), visitors asking
// for a demo or a person, and emails left in the chat for a follow-up.
const KINDS = {
  unanswered: { label: 'Unanswered', tone: 'warning' },
  outage: { label: 'AI unavailable', tone: 'warning' },
  human_request: { label: 'Wants a person', tone: 'green' },
  demo_request: { label: 'Demo request', tone: 'success' },
  contact_request: { label: 'Follow-up', tone: 'green' }
};

// The last mile of the feedback loop: write the missing answer right here, and
// it's published as a knowledge document (so the bots answer it next time) while
// the ticket is marked resolved — no detour to the Documents page. The question
// becomes the document's title on the server; this form only takes the answer.
function AnswerForm({ question, onSave, onCancel }) {
  const [answer, setAnswer] = useState('');
  const [category, setCategory] = useState('FAQ');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!answer.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ answer: answer.trim(), category });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-white/10 bg-panel-2/50 p-4">
      <p className="text-xs text-fg-3">
        Answering: <span className="text-fg-2">{question}</span>
      </p>
      <Field label="Your answer" hint="Published as a knowledge document the bots can use from the next message on.">
        <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Write the answer the bot should have given…" autoFocus />
      </Field>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="File under" className="w-48">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.short}</option>)}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button variant="primary" onClick={submit} loading={saving} disabled={!answer.trim()}>Publish answer</Button>
          <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

export default function TicketsList({ ws }) {
  const toast = useToast();
  const [tickets, setTickets] = useState(null);
  const [answeringId, setAnsweringId] = useState(null);
  useEffect(() => { ws.listTickets().then(setTickets).catch((e) => toast.error(e.message)); }, [ws]);

  const answer = async (ticket, payload) => {
    try {
      await ws.answerTicket(ticket.id, payload);
      // Reflect the resolution locally so the row updates without a refetch.
      setTickets((prev) => prev.map((t) => (t.id === ticket.id ? { ...t, status: 'answered' } : t)));
      setAnsweringId(null);
      toast.success('Answer published — the bots can use it now.');
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <Card>
      <CardHeader title="Tickets and follow-ups"
        description="Questions the bots couldn't answer, plus visitors who asked for a demo or a person. Add the answer here and the bots will use it next time." />
      <div className="p-5">
        {!tickets ? <Skeleton className="h-32" /> : tickets.length === 0 ? (
          <EmptyState icon={<IconTicket className="h-5 w-5" />} title="No tickets">Every question so far was answered from your documents.</EmptyState>
        ) : (
          <ul className="divide-y divide-white/[0.05]">
            {tickets.map((t) => {
              const kind = KINDS[t.kind] || KINDS.unanswered;
              const isOpen = t.status === 'open';
              return (
                <li key={t.id} className="py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm text-fg">{t.query}</p>
                      {t.contactEmail && (
                        <a href={`mailto:${t.contactEmail}`} className="text-xs text-brand-300 underline-offset-2 hover:underline">
                          {t.contactEmail}
                        </a>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-fg-3">
                      <Badge tone={kind.tone}>{kind.label}</Badge>
                      {t.botType && <span className="capitalize">{t.botType} bot</span>}
                      {typeof t.confidence === 'number' && <span className="tabular-nums">{Math.round(t.confidence * 100)}% match</span>}
                      <Badge tone={isOpen ? 'warning' : 'neutral'}>{t.status}</Badge>
                      <span>{new Date(t.createdAt).toLocaleString()}</span>
                      {isOpen && answeringId !== t.id && (
                        <Button variant="secondary" size="sm" onClick={() => setAnsweringId(t.id)}>Add the answer</Button>
                      )}
                    </div>
                  </div>
                  {answeringId === t.id && (
                    <AnswerForm question={t.query} onSave={(payload) => answer(t, payload)} onCancel={() => setAnsweringId(null)} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
