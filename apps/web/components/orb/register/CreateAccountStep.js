import { useState } from 'react';
import { Field, Input, Button } from '..';
import { OrbFormCard } from '../auth';
import { useSendOtp } from '../../../lib/onboarding';

// Step 1a (Figma 0A): create account — email + password + confirm, then send the code.
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export default function CreateAccountStep({ account, setAccount, onSent }) {
  const sendOtp = useSendOtp();
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const set = (k) => (e) => setAccount((a) => ({ ...a, [k]: e.target.value }));
  const mismatch = confirm.length > 0 && confirm !== account.password;
  const valid = emailOk(account.email) && account.password.length >= 10 && confirm === account.password;

  const submit = async () => {
    try {
      await sendOtp.mutateAsync(account.email.trim());
      onSent();
    } catch (err) {
      // A code sent moments ago is still valid — go to the code screen anyway.
      if (err?.status === 429) onSent();
      // other errors surfaced below (thrown Error carries .message / .status)
    }
  };

  return (
    <OrbFormCard
      title="Create your account"
      subtitle="Your sign-in for the Orb console. We’ll email you a code to confirm it’s your address."
      footer={<div className="flex justify-end">
        <Button variant="primary" size="md" onClick={submit} disabled={!valid || sendOtp.isPending}>
          {sendOtp.isPending ? 'Sending…' : 'Send code'}
        </Button>
      </div>}
    >
      <div className="flex flex-col gap-5">
        <Field label="Work email"><Input type="email" value={account.email} onChange={set('email')} placeholder="you@clinic.com" /></Field>
        <Field label="Password" helper="At least 10 characters."><Input type="password" value={account.password} onChange={set('password')} /></Field>
        <Field label="Confirm password" helper={touched && mismatch ? '' : 'Re-enter your password.'}>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onBlur={() => setTouched(true)} />
        </Field>
        {touched && mismatch && <p className="orb-small text-red-600">Passwords don’t match.</p>}
        {sendOtp.error && <p className="orb-small text-red-600">{sendOtp.error.message}</p>}
        <div className="rounded-[10px] bg-orb-subtle px-3.5 py-3">
          <p className="orb-small text-orb-secondary">We save your progress so you can come back to it. We may email you a reminder; unsubscribe any time.</p>
        </div>
      </div>
    </OrbFormCard>
  );
}
