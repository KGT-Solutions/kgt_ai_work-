import { Card, Pill, IconFile } from '..';

// "Knowledge Orb can use" — the sources list (compact, not a table).
// props: subtitle, sources [{ title, sub, category:{label,tone}, chars }], note (node)
export default function SourcesCard({ subtitle, sources = [], note }) {
  return (
    <Card title="Knowledge Orb can use" subtitle={subtitle}>
      <ul className="flex flex-col gap-3.5">
        {sources.map((s) => (
          <li key={s.title} className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orb-subtle text-orb-ink"><IconFile size={16} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate orb-body-strong text-orb-ink">{s.title}</p>
                <Pill tone={s.category.tone || 'neutral'}>{s.category.label}</Pill>
              </div>
              <p className="truncate orb-small text-orb-secondary">{s.sub}</p>
            </div>
            <span className="shrink-0 orb-body text-orb-secondary">{s.chars}</span>
          </li>
        ))}
      </ul>
      {note && <div className="mt-4 rounded-[10px] bg-orb-subtle px-3 py-2.5 orb-small text-orb-secondary">{note}</div>}
    </Card>
  );
}
