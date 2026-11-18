import { forwardRef } from 'react';
import { cx } from './util';

// Text input (§9): 38 tall, r8, 1px control border, focus = 2px dark-grey.
const BASE = 'w-full rounded-lg border border-orb-stroke bg-orb-white px-3 orb-body text-orb-ink placeholder:text-orb-tertiary focus:border-orb-ink focus:outline-none focus:ring-1 focus:ring-orb-ink';

export const Input = forwardRef(function Input({ className = '', ...rest }, ref) {
  return <input ref={ref} className={cx(BASE, 'h-[38px]', className)} {...rest} />;
});

export const Textarea = forwardRef(function Textarea({ className = '', rows = 6, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cx(BASE, 'resize-y py-2 leading-relaxed', className)} {...rest} />;
});

export default Input;
