import { Card, Button, CodeBlock, IconGlobe, IconLock } from '..';

// "Your snippets" — the two embed snippets (public / behind-login) with a
// "make a key" action each, plus the footer note.
// props: snippets [{ id, icon:'globe'|'lock', title, sub, code, onMakeKey }], footerNote
const ICON = { globe: IconGlobe, lock: IconLock };

export default function SnippetsCard({ snippets = [], footerNote }) {
  return (
    <Card title="Your snippets" subtitle="Two snippets, the same Orb. Use the one that matches where the page is.">
      <div className="flex flex-col gap-6">
        {snippets.map((s) => {
          const Icon = ICON[s.icon] || IconGlobe;
          return (
            <div key={s.id}>
              <div className="mb-2.5 flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orb-subtle text-orb-ink"><Icon size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="orb-body-strong text-orb-ink">{s.title}</p>
                  <p className="orb-small text-orb-secondary">{s.sub}</p>
                </div>
                <Button onClick={s.onMakeKey}>Make a key and fill it in</Button>
              </div>
              <CodeBlock code={s.code} />
            </div>
          );
        })}
      </div>
      {footerNote && <p className="mt-5 orb-small text-orb-secondary">{footerNote}</p>}
    </Card>
  );
}
