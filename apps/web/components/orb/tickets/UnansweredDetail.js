import { useState } from 'react';
import { Pill, Button, Textarea, Select, OrbMark } from '..';

// Right pane for the "Unanswered" tab: the grouped question with how it was
// asked, what Orb said, who's waiting, and an answer composer.
export default function UnansweredDetail({ ticket, className = '' }) {
  const [answer, setAnswer] = useState(ticket?.answerText || '');
  const [category, setCategory] = useState('policies');
  if (!ticket) return null;

  return (
    <div className={`orb-scrollbar flex flex-col overflow-y-auto ${className}`}>
      <div className="flex items-start gap-3 border-b border-orb-hairline px-6 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="orb-card-title text-orb-ink">{ticket.title}</span>
            {ticket.pill && <Pill tone={ticket.pill.tone}>{ticket.pill.label}</Pill>}
          </div>
          <p className="mt-1 orb-small text-orb-secondary">{ticket.meta}</p>
        </div>
        <Button>Mark as done</Button>
      </div>

      <div className="px-6 py-5">
        <div className="flex items-center justify-between">
          <p className="orb-body-strong text-orb-ink">How visitors asked</p>
          <button type="button" className="orb-small-medium text-orb-ink hover:underline focus:outline-none">{ticket.seeAll}</button>
        </div>
        <ul className="mt-3 divide-y divide-orb-hairline">
          {ticket.asked?.map((a, i) => (
            <li key={i} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="orb-body text-orb-ink">{a.q}</p>
                <p className="mt-0.5 orb-small text-orb-secondary">{a.meta}</p>
              </div>
              <button type="button" className="shrink-0 orb-small-medium text-orb-ink hover:underline focus:outline-none">Open conversation</button>
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-xl bg-orb-subtle p-4">
          <p className="orb-body-strong text-orb-ink">What Orb told them</p>
          <div className="mt-2 flex gap-2.5">
            <OrbMark size={28} />
            <p className="orb-body text-orb-ink">{ticket.orbReply}</p>
          </div>
          <p className="mt-2 orb-small text-orb-secondary">{ticket.orbNote}</p>
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="orb-body-strong text-orb-ink">{ticket.waitingLabel}</p>
          <Button>Open in Leads &amp; bookings</Button>
        </div>
        <ul className="mt-2 divide-y divide-orb-hairline">
          {ticket.contacts?.map((c, i) => (
            <li key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-4 py-2.5">
              <span className="truncate orb-body text-orb-ink">{c.name}</span>
              <span className="truncate orb-body text-orb-secondary">{c.contact}</span>
              <span className="orb-small text-orb-tertiary">{c.date}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 rounded-xl border border-orb-hairline p-5">
          <p className="orb-body-strong text-orb-ink">Add the answer</p>
          <p className="mt-0.5 orb-small text-orb-secondary">Write it once. Orb uses it from the very next question.</p>
          <Textarea className="mt-3" rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="orb-small-medium text-orb-secondary">Category</span>
              <Select value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: 'policies', label: 'Policies & pricing' }, { value: 'faq', label: 'FAQ' }, { value: 'overview', label: 'Company overview' }]} />
            </div>
            <Button variant="primary">Save to knowledge</Button>
          </div>
          <p className="mt-2 orb-small text-orb-secondary">{ticket.answerNote}</p>
        </div>
      </div>
    </div>
  );
}
