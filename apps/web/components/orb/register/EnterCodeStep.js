import { useState } from 'react';
import { Button, cx } from '..';
import { OrbFormCard } from '../auth';
import { useSendOtp, useVerifyOtp } from '../../../lib/onboarding';

// Step 1b (Figma 0B): the 6-digit email code. The boxes mirror a single hidden
// input; two groups of three with a dash between. Verifying returns the
// verificationToken that /register/complete requires.
function OtpBox({ value, active }) {
  return (
    <span className={cx('flex size-14 items-center justify-center rounded-xl orb-figure-sm text-orb-ink', active ? 'bg-orb-white ring-2 ring-orb-ink' : 'bg-orb-subtle')}>
      {value}
    </span>
  );
}

export default function EnterCodeStep({ email, onVerified, onDifferentEmail }) {
  const [code, setCode] = useState('');
  const verifyOtp = useVerifyOtp();
  const resend = useSendOtp();
  const d = (i) => code[i] || '';

  const verify = async (otp = code) => {
    if (otp.length !== 6 || verifyOtp.isPending) return;
    try {
      const res = await verifyOtp.mutateAsync({ email, otp });
      onVerified({ email: res.email, token: res.verificationToken });
    } catch {
      setCode('');
    }
  };

  const onChange = (next) => {
    setCode(next);
    if (next.length === 6) verify(next); // auto-submit on the sixth digit
  };

  const error = verifyOtp.error?.message;

  return (
    <OrbFormCard
      title="Check your email"
      subtitle={`We sent a 6-digit code to ${email || 'your email'}. It works for 10 minutes.`}
      footer={(
        <div className="flex items-center justify-between">
          <button type="button" onClick={onDifferentEmail} className="orb-small-medium text-orb-ink underline focus:outline-none">Use a different email</button>
          <Button variant="primary" size="md" onClick={() => verify()} disabled={code.length !== 6 || verifyOtp.isPending}>
            {verifyOtp.isPending ? 'Verifying…' : 'Verify'}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col items-center gap-2">
        <p className="orb-small-medium text-orb-secondary">Code</p>
        <label className="relative flex items-center gap-2">
          {[0, 1, 2].map((i) => <OtpBox key={i} value={d(i)} active={code.length === i} />)}
          <span className="px-1 text-orb-tertiary">—</span>
          {[3, 4, 5].map((i) => <OtpBox key={i} value={d(i)} active={code.length === i} />)}
          <input
            className="absolute inset-0 cursor-pointer opacity-0"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
            aria-label="6-digit code"
            autoFocus
          />
        </label>
        {error && <p className="mt-1 orb-small text-red-600">{error}</p>}
        <p className="mt-1 text-center orb-small text-orb-secondary">
          Didn’t get it? Check your spam folder, or{' '}
          <button type="button" onClick={() => resend.mutateAsync(email).catch(() => {})} disabled={resend.isPending}
            className="orb-small-medium text-orb-ink underline focus:outline-none disabled:text-orb-tertiary disabled:no-underline">
            {resend.isPending ? 'sending…' : 'resend the code'}
          </button>.
        </p>
      </div>
    </OrbFormCard>
  );
}
