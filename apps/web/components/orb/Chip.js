import { cx } from './util';

// Filter chip / tab with an optional count (§8 Console/Chip), e.g. "Website 42".
export default function Chip({ selected, count, children, onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 orb-small-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink',
        selected ? 'bg-orb-ink text-orb-white' : 'border border-orb-stroke bg-orb-white text-orb-secondary hover:text-orb-ink',
        className
      )}
    >
      {children}
      {count != null && <span className={cx('orb-small-medium', selected ? 'text-orb-white/70' : 'text-orb-tertiary')}>{count}</span>}
    </button>
  );
}
