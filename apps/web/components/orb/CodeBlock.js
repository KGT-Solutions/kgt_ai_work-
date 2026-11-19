import { cx } from './util';

// Code box (§5 r12, §2 surface-subtle, §3 Console/Code). Read-only snippet
// display; preserves whitespace and scrolls horizontally when long.
export default function CodeBlock({ code, className = '' }) {
  return (
    <pre className={cx('orb-scrollbar overflow-x-auto rounded-xl bg-orb-subtle px-4 py-3 orb-code text-orb-ink', className)}>
      <code>{code}</code>
    </pre>
  );
}
