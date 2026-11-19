import { Switch } from '@headlessui/react';
import { cx } from './util';

// Toggle (§8 Console/Toggle) — a switch that acts straight away. Built on
// Headless UI Switch. Controlled via checked/onChange.
export default function Toggle({ checked, onChange, ariaLabel }) {
  return (
    <Switch
      checked={!!checked}
      onChange={onChange}
      aria-label={ariaLabel}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink',
        checked ? 'bg-orb-ink' : 'bg-orb-light-grey'
      )}
    >
      <span className={cx('inline-block size-4 transform rounded-full bg-orb-white transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </Switch>
  );
}
