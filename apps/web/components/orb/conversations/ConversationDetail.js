import { Pill, Button, OrbMark, IconFile, IconCalendar, IconUser, IconFlag, IconSpark, IconLock } from '..';

// Right pane: the selected conversation. props: convo { name, pills, meta, summary,
// summaryMeta, messages, footer }
const BOX_ICON = { ticket: IconFile, action: IconCalendar, lead: IconUser };

function AnnotationBox({ icon, text }) {
  const Icon = BOX_ICON[icon] || IconFile;
  return (
    <span className="mt-2 inline-flex items-center gap-2 rounded-lg bg-orb-subtle px-3 py-1.5 orb-small text-orb-secondary">
      <Icon size={14} />{text}
    </span>
  );
}

function Message({ m, onCorrect }) {
  if (m.role === 'visitor') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%]">
          <p className="rounded-2xl rounded-br-md bg-orb-subtle px-4 py-2.5 orb-body text-orb-ink">{m.text}</p>
          {m.time && <p className="mt-1 text-right orb-small text-orb-tertiary">{m.time}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <OrbMark size={28} />
      <div className="min-w-0 max-w-[86%]">
        <p className="orb-body text-orb-ink">{m.text}</p>
        {m.source && <p className="mt-1.5 orb-small text-orb-secondary">{m.source}</p>}
        {m.correct && (
          <button type="button" onClick={onCorrect} className="mt-1 flex items-center gap-1.5 orb-small text-orb-secondary hover:text-orb-ink focus:outline-none">
            <IconFlag size={13} /> Wrong or out of date? <span className="orb-small-medium text-orb-ink underline">Correct this answer</span>
          </button>
        )}
        {m.boxes?.length > 0 && <div className="flex flex-wrap gap-2">{m.boxes.map((b, i) => <AnnotationBox key={i} icon={b.icon} text={b.text} />)}</div>}
      </div>
    </div>
  );
}

export default function ConversationDetail({ convo, className = '' }) {
  if (!convo) return null;
  return (
    <div className={`flex flex-col ${className}`}>
      <div className="flex items-start gap-3 border-b border-orb-hairline px-6 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="orb-card-title text-orb-ink">{convo.name}</span>
            {convo.pills?.map((p, i) => <Pill key={i} tone={p.tone}>{p.label}</Pill>)}
          </div>
          <p className="mt-1 orb-small text-orb-secondary">{convo.meta}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button>Open lead</Button>
          <Button>Open ticket</Button>
        </div>
      </div>

      <div className="orb-scrollbar flex-1 overflow-y-auto px-6 py-5">
        {convo.summary && (
          <div className="mb-5 rounded-xl bg-orb-subtle px-4 py-3">
            <p className="flex items-center gap-1.5 orb-small-strong text-orb-ink"><IconSpark size={14} /> AI summary <span className="orb-small text-orb-secondary">· {convo.summaryMeta}</span></p>
            <p className="mt-1.5 orb-small text-orb-secondary">{convo.summary}</p>
          </div>
        )}
        <div className="flex flex-col gap-5">
          {convo.messages?.map((m, i) => <Message key={i} m={m} />)}
        </div>
      </div>

      {convo.footer && (
        <div className="flex items-center gap-2 border-t border-orb-hairline px-6 py-3.5">
          <span className="text-orb-tertiary"><IconLock size={14} /></span>
          <span className="orb-small text-orb-secondary">{convo.footer}</span>
        </div>
      )}
    </div>
  );
}
