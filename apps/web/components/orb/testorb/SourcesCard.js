import { Card, Pill, IconFile } from '..';

// "Knowledge Orb can use" — the sources list (compact, not a table).
// props: subtitle, sources [{ id, title, category:{label,tone}, chars }]
export default function SourcesCard({ subtitle, sources = [] }) {
  return (
    <Card title="Knowledge Orb can use" subtitle={subtitle}>
      <ul className="flex flex-col gap-3.5">
        {sources.map((s) => (
          <li key={s.id ?? s.title} className="flex items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orb-subtle text-orb-ink"><IconFile size={16} /></span>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <p className="truncate orb-body-strong text-orb-ink">{s.title}</p>
              <Pill tone={s.category.tone || 'neutral'}>{s.category.label}</Pill>
            </div>
            <span className="shrink-0 orb-body text-orb-secondary">{s.chars}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
