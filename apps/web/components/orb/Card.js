import { cx } from './util';

// Card shell (Orb §6 Elevation · Card): white, r16, 1px hairline, no drop shadow.
// Optional header (title left, `headerRight` slot) + padded body. Padding follows
// §4 (card padding 28 → p-7).
//
// props: title, headerRight, children, className, bodyClassName, as
export default function Card({ title, subtitle, headerRight, children, className = '', bodyClassName = '', as: Tag = 'section' }) {
  const hasHeader = title != null || subtitle != null || headerRight != null;
  return (
    <Tag className={cx('flex flex-col rounded-2xl border border-orb-hairline bg-orb-white', className)}>
      {hasHeader && (
        <div className="flex items-start gap-3 px-7 pt-7">
          {(title || subtitle) && (
            <div className="min-w-0">
              {title && <h3 className="orb-card-title text-orb-ink">{title}</h3>}
              {subtitle && <p className="mt-0.5 orb-small text-orb-secondary">{subtitle}</p>}
            </div>
          )}
          {headerRight && <div className="ml-auto flex items-center gap-2">{headerRight}</div>}
        </div>
      )}
      <div className={cx(hasHeader ? 'px-7 pb-7 pt-4' : 'p-7', 'flex-1', bodyClassName)}>{children}</div>
    </Tag>
  );
}

// The small expand/details affordance seen at the top-right of several cards.
export function CardExpandButton({ onClick, label = 'Expand' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex size-6 items-center justify-center rounded-md text-orb-secondary transition-colors hover:bg-orb-subtle hover:text-orb-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.33" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3.5l4.5 4.5L6 12.5" />
      </svg>
    </button>
  );
}
