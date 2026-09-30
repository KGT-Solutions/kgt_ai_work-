import { API_KEY_PLACEHOLDER, embedSnippet } from '../../lib/api';
import { CodeBlock, cx } from '../ui';
import { IconBolt, IconShield } from '../ui/icons';

// The two widget snippets every tenant gets: the Sales Bot for public pages
// and the Support Bot for signed-in areas. Each snippet pins its bot with
// data-bot, so the API answers with that bot's persona and knowledge weighting.
//
// apiKey: the plaintext key when this browser holds one (just issued);
// otherwise the snippets carry a placeholder the tenant swaps for their key.

const SNIPPETS = [
  {
    bot: 'sales',
    title: 'Public Sales widget',
    icon: IconBolt,
    tone: 'text-violet-300',
    filename: 'sales-widget.html',
    where: 'For your landing, pricing and product pages, and anywhere prospects browse. It answers questions about value, plans, pricing and features, and ends with a next step.'
  },
  {
    bot: 'support',
    title: 'Member Support widget',
    icon: IconShield,
    tone: 'text-cyan-300',
    filename: 'support-widget.html',
    where: 'For logged-in customer dashboards, member or resident portals, and help centers. It gives grounded, step-by-step answers and hands off to your team when unsure.'
  }
];

export default function EmbedSnippets({ slug, apiKey, className = '' }) {
  return (
    <div className={cx('space-y-4', className)}>
      <div className="grid gap-4 xl:grid-cols-2">
        {SNIPPETS.map((s) => {
          const Icon = s.icon;
          return (
            <section key={s.bot} className="min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <Icon className={cx('h-4 w-4', s.tone)} />
                <h3 className="text-sm font-semibold text-fg">{s.title}</h3>
                <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[11px] text-fg-2">data-bot=&quot;{s.bot}&quot;</code>
              </div>
              <p className="text-[13px] leading-relaxed text-fg-3">{s.where}</p>
              <CodeBlock filename={s.filename} code={embedSnippet(slug, apiKey, s.bot)} />
            </section>
          );
        })}
      </div>
      <p className="text-[12.5px] text-fg-3">
        Paste a snippet just before <code className="text-fg-2">{'</body>'}</code>. Use one widget per page.
        {!apiKey && <> Replace <code className="text-fg-2">{API_KEY_PLACEHOLDER}</code> with one of your API keys.</>}
      </p>
    </div>
  );
}
