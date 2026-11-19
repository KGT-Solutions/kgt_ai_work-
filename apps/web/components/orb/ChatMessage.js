import OrbMark from './OrbMark';
import { IconFile, IconCalendar, IconUser, IconFlag } from './icons';

// Shared chat bubble (visitor right / Orb left) with optional source, a
// "correct this answer" affordance, and annotation boxes (ticket/action/lead).
const BOX_ICON = { ticket: IconFile, action: IconCalendar, lead: IconUser };

export function AnnotationBox({ icon, text }) {
  const Icon = BOX_ICON[icon] || IconFile;
  return (
    <span className="mt-2 inline-flex items-center gap-2 rounded-lg bg-orb-subtle px-3 py-1.5 orb-small text-orb-secondary">
      <Icon size={14} />{text}
    </span>
  );
}

export default function ChatMessage({ m, onCorrect }) {
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
