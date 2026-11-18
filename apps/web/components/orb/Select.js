import { cx } from './util';

// Orb select (§8 Console/Select, Small 28). Native <select> styled to the design
// system — accessible and data-ready (controlled via value/onChange).
//
// props: value, onChange, options [{ value, label }], className
export default function Select({ value, onChange, options = [], className = '', ariaLabel, fullWidth = false, size = 'sm' }) {
  return (
    <div className={cx('relative', fullWidth ? 'flex w-full' : 'inline-flex', className)}>
      <select
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        className={cx(
          'appearance-none rounded-lg border border-orb-stroke bg-orb-white pl-3 pr-8 text-orb-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink',
          size === 'md' ? 'h-[38px] orb-body' : 'h-7 orb-small-medium',
          fullWidth && 'w-full'
        )}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <svg viewBox="0 0 14 14" width="14" height="14" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-orb-secondary" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 5.5L7 8.5l3-3" />
      </svg>
    </div>
  );
}
