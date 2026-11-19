import { cx } from './util';

// Segmented control (e.g. English | Hindi). Controlled via value/onChange.
// props: options [{ value, label }], value, onChange, ariaLabel
export default function Segmented({ options = [], value, onChange, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-lg bg-orb-subtle p-0.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange?.(o.value)}
            className={cx('rounded-md px-3 py-1 orb-small-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink',
              active ? 'bg-orb-white text-orb-ink shadow-orb-raised' : 'text-orb-secondary hover:text-orb-ink')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
