import { useState } from 'react';
import { Card, Pill, Button, Chip, Input, cx } from '..';
import { IconFile, IconSearch, IconChevronRight } from '../icons';

// "Knowledge Orb can use" — tabs + search in the header, then the entries table.
// props: subtitle, tabs [{key,label,count}], activeTab, onTab, search, onSearch,
//        entries [{ id, title, sub, category:{label,tone}, usedBy, chars, added, content }],
//        loading, error, footerNote, onLoadMore
//
// Origin: file/written can't be told apart from the data yet, so every row uses
// one generic origin icon (mock). The "Used by" badge is the bot scope (botScope).
export default function KnowledgeTable({
  subtitle, tabs = [], activeTab, onTab, search, onSearch, entries = [], loading, error, footerNote, onLoadMore
}) {
  const [expanded, setExpanded] = useState(null);

  return (
    <Card
      title="Knowledge Orb can use"
      subtitle={subtitle}
      headerRight={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Filter tabs, to the left of the search box */}
          <div className="flex flex-wrap gap-2">
            {tabs.map((t) => (
              <Chip key={t.key} selected={activeTab === t.key} count={t.count} onClick={() => onTab?.(t.key)}>{t.label}</Chip>
            ))}
          </div>
          <div className="relative w-56">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-orb-tertiary"><IconSearch size={15} /></span>
            <Input value={search} onChange={(e) => onSearch?.(e.target.value)} placeholder="Search entries" className="h-8 pl-8" />
          </div>
        </div>
      }
    >
      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-orb-hairline">
        <div className="grid grid-cols-[1fr_200px_110px_80px_32px] items-center gap-3 bg-orb-subtle px-4 py-2.5">
          {['Entry', 'Category', 'Characters', 'Added', ''].map((h, i) => (
            <span key={i} className="orb-heading text-orb-secondary">{h}</span>
          ))}
        </div>

        {loading ? (
          <div className="divide-y divide-orb-hairline">
            {[0, 1, 2].map((i) => <div key={i} className="h-[52px] animate-pulse bg-orb-subtle/40" />)}
          </div>
        ) : error ? (
          <p className="px-4 py-8 text-center orb-small text-red-600">{error}</p>
        ) : entries.length === 0 ? (
          <p className="px-4 py-8 text-center orb-small text-orb-secondary">No entries yet — scan your website, upload files, or write an entry.</p>
        ) : (
          <ul className="divide-y divide-orb-hairline">
            {entries.map((e) => {
              const open = expanded === e.id;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : e.id)}
                    aria-expanded={open}
                    className="grid w-full grid-cols-[1fr_200px_110px_80px_32px] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-orb-subtle/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orb-ink"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orb-subtle text-orb-ink"><IconFile size={16} /></span>
                      <div className="min-w-0">
                        <p className="truncate orb-body-strong text-orb-ink">{e.title}</p>
                        <p className="truncate orb-small text-orb-secondary">{e.sub}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Pill tone={e.category.tone || 'neutral'}>{e.category.label}</Pill>
                      {e.usedBy && <Pill tone="outline">{e.usedBy}</Pill>}
                    </div>
                    <span className="orb-body text-orb-secondary">{e.chars}</span>
                    <span className="orb-body text-orb-secondary">{e.added}</span>
                    <span className={cx('flex justify-end text-orb-tertiary transition-transform', open ? 'rotate-90' : '')}><IconChevronRight size={16} /></span>
                  </button>
                  {open && (
                    <div className="border-t border-orb-hairline bg-orb-subtle/30 px-4 py-3">
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-orb-secondary">{e.content}</pre>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="orb-small text-orb-secondary">{footerNote}</span>
        {onLoadMore && <Button onClick={onLoadMore}>Show more</Button>}
      </div>
    </Card>
  );
}
