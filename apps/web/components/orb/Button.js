import { cx } from './util';

// Orb button (§8 Console/Button). One Primary (dark) per view; everything else
// Secondary (outlined). r8, label hugs.
const VARIANTS = {
  primary: 'bg-orb-ink text-orb-white hover:bg-black',
  secondary: 'border border-orb-stroke bg-orb-white text-orb-ink hover:bg-orb-subtle'
};
const SIZES = { sm: 'h-7 px-2.5 orb-small-medium gap-1.5', md: 'h-8 px-3 orb-body-strong gap-2' };

export default function Button({ variant = 'secondary', size = 'sm', className = '', type = 'button', ...rest }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink',
        VARIANTS[variant], SIZES[size], className
      )}
      {...rest}
    />
  );
}
