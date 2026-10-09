import { useEffect, useRef } from 'react';
import { cx } from './index';

// Six single-digit boxes: auto-advance, backspace to previous, paste a whole
// code. value is an array of 6 strings ('' for empty). Used by the
// forgot-password page and the signup wizard's email verification.
export default function OtpInput({ value, onChange, disabled, invalid, autoFocus = true }) {
  const refs = useRef([]);
  useEffect(() => { if (autoFocus) refs.current[0]?.focus(); }, [autoFocus]);

  const setAt = (i, digit) => {
    const next = [...value];
    next[i] = digit;
    onChange(next);
  };

  const onPaste = (e) => {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6).split('');
    if (!digits.length) return;
    e.preventDefault();
    onChange([...digits, ...Array(6 - digits.length).fill('')]);
    refs.current[Math.min(digits.length, 5)]?.focus();
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit code" onPaste={onPaste}>
      {value.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} value={d} inputMode="numeric" autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={1} disabled={disabled} aria-label={`Digit ${i + 1}`} aria-invalid={invalid || undefined}
          onChange={(e) => {
            const digit = e.target.value.replace(/\D/g, '').slice(-1);
            setAt(i, digit);
            if (digit && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !value[i] && i > 0) refs.current[i - 1]?.focus();
            if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
            if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
          }}
          className={cx('h-12 w-full rounded-lg border bg-panel-2/80 text-center font-mono text-lg text-fg focus:outline-none focus:ring-4 disabled:opacity-50',
            invalid ? 'border-rose-400/60 focus:border-rose-400 focus:ring-rose-400/10' : 'border-white/10 focus:border-brand-400/60 focus:ring-brand-400/10')} />
      ))}
    </div>
  );
}
