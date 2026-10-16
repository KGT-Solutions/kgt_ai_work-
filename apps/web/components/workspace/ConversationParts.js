import { useState } from 'react';
import { cx } from '../ui';
import { IconChevronDown } from '../ui/icons';

// Pieces shared by the Leads and Sessions views of Leads & Summaries.

export const BOTS = {
  sales: { label: 'Sales bot', tone: 'green' },
  support: { label: 'Support bot', tone: 'blue' }
};

// Answers below this are flagged in the transcript; the API emails the team
// about them too (services/teamAlerts.js, LOW_CONFIDENCE_ALERT_BELOW). Correct
// answers normally score 33-50% (engine/confidence.js), so not higher.
export const LOW_CONFIDENCE = 0.25;

// The AI summary's labelled lines (services/leads.js buildSummaryPrompt).
const LABELS = /^(intent|key questions|outcome|follow-up actions):\s*/i;

// "Intent: ..." is the summary's first line (the prompt asks for it); fall
// back to the first line of whatever the model wrote.
export function intentLine(summary) {
  const lines = String(summary || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const intent = lines.find((l) => /^intent:/i.test(l)) || lines[0] || '';
  return intent.replace(/^intent:\s*/i, '');
}

export function outcomeLine(summary) {
  const line = String(summary || '').split('\n').map((l) => l.trim()).find((l) => /^outcome:/i.test(l));
  return line ? line.replace(/^outcome:\s*/i, '') : '';
}

/** The summary with its labels set apart; older summaries without labels render as plain text. */
export function SummaryText({ summary }) {
  const lines = String(summary || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <div className="space-y-1 text-[13px] leading-relaxed text-fg-2">
      {lines.map((line, i) => {
        const label = line.match(LABELS);
        if (!label) return <p key={i} className={line.startsWith('•') ? 'pl-3' : ''}>{line}</p>;
        const rest = line.slice(label[0].length);
        return (
          <p key={i} className={cx(i > 0 && 'pt-1.5')}>
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-fg-3">{label[1]}</span>
            {rest && <span className="ml-2 text-fg">{rest}</span>}
          </p>
        );
      })}
    </div>
  );
}

/**
 * The raw chat, folded away: the summary is what staff read first, and the
 * transcript is there for whoever wants to check the details.
 */
export function TranscriptToggle({ messages, showMeta = true }) {
  const [open, setOpen] = useState(false);
  const count = messages?.length || 0;
  return (
    <section className="border-t border-white/[0.06] pt-4">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={!count}
        className="flex items-center gap-1.5 text-[13px] font-medium text-fg-3 transition hover:text-fg-2 disabled:cursor-default disabled:hover:text-fg-3">
        <IconChevronDown className={cx('h-4 w-4 transition-transform', open && 'rotate-180')} />
        {open ? 'Hide full transcript' : 'View full transcript'}
        <span className="font-normal">({count} {count === 1 ? 'message' : 'messages'})</span>
      </button>
      {open && <Transcript messages={messages} showMeta={showMeta} className="mt-3" />}
    </section>
  );
}

/**
 * messages: [{ role, content, createdAt?/at?, confidence? }], oldest first.
 * With showMeta, each bubble shows its time, and low-confidence answers are flagged.
 */
export function Transcript({ messages, showMeta = false, className = 'max-h-96' }) {
  if (!messages?.length) return <p className="text-[13px] text-fg-3">The conversation isn't available.</p>;
  return (
    <ol className={cx('flex flex-col gap-2 overflow-y-auto pr-1', className)}>
      {messages.map((m, i) => {
        const at = m.createdAt || m.at;
        const low = showMeta && m.role === 'assistant' && typeof m.confidence === 'number' && m.confidence < LOW_CONFIDENCE;
        return (
          <li key={m.id || i} className={cx('max-w-[85%] whitespace-pre-line rounded-xl px-3 py-2 text-[13px] leading-relaxed',
            m.role === 'user' ? 'self-end bg-cyan-400/10 text-fg' : 'self-start bg-white/[0.04] text-fg-2',
            low && 'ring-1 ring-amber-400/30')}>
            <span className="mb-0.5 flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-wide text-fg-3">
              {m.role === 'user' ? 'Visitor' : 'Assistant'}
              {showMeta && at && <span className="font-normal normal-case tracking-normal">{new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
              {low && <span className="normal-case tracking-normal text-amber-300">Low confidence · {Math.round(m.confidence * 100)}%</span>}
            </span>
            {m.content}
          </li>
        );
      })}
    </ol>
  );
}
