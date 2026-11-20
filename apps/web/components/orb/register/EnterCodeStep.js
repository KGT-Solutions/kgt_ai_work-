import { useState } from 'react';
import { Button, cx } from '..';
import { OrbFormCard } from '../auth';

// Step 1b (Figma 0B): the 6-digit email code. The boxes mirror a single hidden
// input; two groups of three with a dash between.
function OtpBox({ value, active }) {
  return (
    <span className={cx('flex size-14 items-center justify-center rounded-xl orb-figure-sm text-orb-ink', active ? 'bg-orb-white ring-2 ring-orb-ink' : 'bg-orb-subtle')}>
      {value}
    </span>
  );
}

export default function EnterCodeStep({ email, onVerify, onDifferentEmail }) {
  const [code, setCode] = useState('');
  const d = (i) => code[i] || '';

  return (
    <OrbFormCard
      title="Check your email"
      subtitle={`We sent a 6-digit code to ${email || 'your email'}. It works for 10 minutes.`}
      footer={(
        <div className="flex items-center justify-between">
          <button type="button" onClick={onDifferentEmail} className="orb-small-medium text-orb-ink underline focus:outline-none">Use a different email</button>
          <Button variant="primary" size="md" onClick={onVerify}>Verify</Button>
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
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            aria-label="6-digit code"
            autoFocus
          />
        </label>
        <p className="mt-1 text-center orb-small text-orb-secondary">Didn’t get it? Check your spam folder. You can ask for a new code in 0:42.</p>
      </div>
    </OrbFormCard>
  );
}
