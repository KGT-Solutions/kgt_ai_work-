import { Card } from '..';
import { IconGlobe, IconUpload, IconPen, IconChevronRight } from '../icons';

// "Add knowledge" — the three ways in. Each row opens its drawer via onPick(key).
// props: note, onPick
const WAYS = [
  { key: 'scan', Icon: IconGlobe, title: 'Scan a website', desc: 'Up to 12 pages per scan. Untick any you don’t want.' },
  { key: 'upload', Icon: IconUpload, title: 'Upload files', desc: 'PDF, Word, TXT or MD up to 10 MB. ZIP up to 25 MB.' },
  { key: 'write', Icon: IconPen, title: 'Write an entry', desc: 'A title and text, for what your site doesn’t say.' }
];

export default function AddKnowledgeCard({ note, onPick }) {
  return (
    <Card title="Add knowledge" subtitle="Three ways in. Pick a category for each entry.">
      <div className="flex flex-col gap-2">
        {WAYS.map(({ key, Icon, title, desc }) => (
          <button
            key={key}
            type="button"
            onClick={() => onPick?.(key)}
            className="flex items-center gap-3 rounded-xl border border-orb-hairline bg-orb-white p-3 text-left transition-colors hover:border-orb-stroke hover:bg-orb-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-orb-subtle text-orb-ink"><Icon size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block orb-body-strong text-orb-ink">{title}</span>
              <span className="block orb-small text-orb-secondary">{desc}</span>
            </span>
            <span className="shrink-0 text-orb-tertiary"><IconChevronRight size={16} /></span>
          </button>
        ))}
      </div>
      {note && (
        <div className="mt-3 rounded-[10px] bg-orb-subtle px-3 py-2.5">
          <p className="orb-small text-orb-secondary">{note}</p>
        </div>
      )}
    </Card>
  );
}
