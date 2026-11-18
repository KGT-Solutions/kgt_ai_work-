import { Card, Pill, Button, Chip, Input } from '..';
import { IconGlobe, IconFile, IconPen, IconMore, IconSearch } from '../icons';

// "Knowledge Orb can use" — tabs + search + the entries table.
// props: subtitle, tabs [{key,label,count}], activeTab, onTab, search, onSearch,
//        entries [{ id, kind, title, sub, category:{label,tone}, chars, added, status? }],
//        footerNote, onLoadMore
const KIND_ICON = { website: IconGlobe, file: IconFile, written: IconPen };

export default function KnowledgeTable({
  subtitle, tabs = [], activeTab, onTab, search, onSearch, entries = [], footerNote, onLoadMore
}) {
  return (
    <Card
      title="Knowledge Orb can use"
      subtitle={subtitle}
      headerRight={
        <div className="relative w-56">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-orb-tertiary"><IconSearch size={15} /></span>
          <Input value={search} onChange={(e) => onSearch?.(e.target.value)} placeholder="Search entries" className="h-8 pl-8" />
        </div>
      }
    >
      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Chip key={t.key} selected={activeTab === t.key} count={t.count} onClick={() => onTab?.(t.key)}>{t.label}</Chip>
        ))}
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-orb-hairline">
        <div className="grid grid-cols-[1fr_120px_110px_90px_120px] items-center gap-3 bg-orb-subtle px-4 py-2.5">
          {['Entry', 'Category', 'Characters', 'Added', ''].map((h, i) => (
            <span key={i} className="orb-heading text-orb-secondary">{h}</span>
          ))}
        </div>
        <ul className="divide-y divide-orb-hairline">
          {entries.map((e) => {
            const Icon = KIND_ICON[e.kind] || IconFile;
            return (
              <li key={e.id} className="grid grid-cols-[1fr_120px_110px_90px_120px] items-center gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orb-subtle text-orb-ink"><Icon size={16} /></span>
                  <div className="min-w-0">
                    <p className="truncate orb-body-strong text-orb-ink">{e.title}</p>
                    <p className="truncate orb-small text-orb-secondary">{e.sub}</p>
                  </div>
                </div>
                <div><Pill tone={e.category.tone || 'neutral'}>{e.category.label}</Pill></div>
                <span className="orb-body text-orb-secondary">{e.chars}</span>
                <span className="orb-body text-orb-secondary">{e.added}</span>
                <div className="flex items-center justify-end gap-1.5">
                  {e.status && <Pill tone={e.status.tone || 'yellow'}>{e.status.label}</Pill>}
                  <button type="button" aria-label="More" className="flex size-7 items-center justify-center rounded-lg text-orb-secondary transition-colors hover:bg-orb-subtle hover:text-orb-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink"><IconMore size={16} /></button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="orb-small text-orb-secondary">{footerNote}</span>
        <Button onClick={onLoadMore}>Show more</Button>
      </div>
    </Card>
  );
}
