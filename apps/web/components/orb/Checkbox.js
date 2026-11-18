import { IconCheck } from './icons';
import { cx } from './util';

// Checkbox (§8 Console/Checkbox, r3). Controlled via checked/onChange.
export default function Checkbox({ checked, onChange, children, className = '' }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-2.5', className)}>
      <span className="relative mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <input type="checkbox" checked={checked} onChange={onChange} className="peer sr-only" />
        <span className={cx('flex size-4 items-center justify-center rounded-[3px] border transition-colors',
          checked ? 'border-orb-ink bg-orb-ink text-orb-white' : 'border-orb-stroke bg-orb-white')}>
          {checked && <IconCheck size={12} />}
        </span>
      </span>
      {children && <span className="orb-small text-orb-secondary">{children}</span>}
    </label>
  );
}
