import { useState } from 'react';
import { Button, Card, CardHeader, Field, Input } from '../ui';
import { IconArrowRight, IconLock } from '../ui/icons';
import EmailVerificationStep from './EmailVerificationStep';

// Signup wizard step 1: sign-in details, then straight into the email code.
// Submitting the email and password sends a 6-digit code (EmailVerificationStep
// sends on arrival) and asks for it here; nothing else in the wizard opens
// until it's verified. "Change" returns to the form with everything kept.

const MIN_PASSWORD_LEN = 10; // mirrors the API
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export default function AccountVerifyStep({ account, setAccount, verified, onVerified, onNext }) {
  // Back on this step with the address already verified: show that, not the form.
  const [phase, setPhase] = useState(verified ? 'verify' : 'form');
  const [touched, setTouched] = useState({});
  const set = (k) => (e) => setAccount((a) => ({ ...a, [k]: e.target.value }));
  const touch = (k) => () => setTouched((t) => ({ ...t, [k]: true }));
  const problems = {
    email: !isValidEmail(account.email) ? 'Enter a valid email address.' : '',
    password: account.password.length < MIN_PASSWORD_LEN ? `Use at least ${MIN_PASSWORD_LEN} characters.` : '',
    confirm: account.confirm !== account.password ? "Passwords don't match." : ''
  };
  const valid = !Object.values(problems).some(Boolean);
  const err = (k) => (touched[k] ? problems[k] : '');

  if (phase === 'verify') {
    return (
      <EmailVerificationStep email={account.email.trim().toLowerCase()} verified={verified} onVerified={onVerified}
        onChangeEmail={() => setPhase('form')} onNext={onNext} nextLabel="Continue to company details"
        doneHint="Next, tell us about your company." />
    );
  }

  return (
    <form noValidate className="mx-auto max-w-lg" onSubmit={(e) => {
      e.preventDefault();
      setTouched({ email: true, password: true, confirm: true });
      if (valid) setPhase('verify');
    }}>
      <Card>
        <CardHeader icon={<IconLock className="h-4 w-4" />} title="Create your account"
          description="Your sign-in for the dashboard where you manage and test your bots. We'll email you a code to confirm the address." />
        <div className="grid gap-5 p-6">
          <Field label="Work email" htmlFor="r-email" error={err('email')}>
            <Input id="r-email" type="email" value={account.email} onChange={set('email')} onBlur={touch('email')} invalid={!!err('email')}
              placeholder="you@company.com" autoComplete="email" autoFocus />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Password" htmlFor="r-password" error={err('password')} hint={`At least ${MIN_PASSWORD_LEN} characters.`}>
              <Input id="r-password" type="password" value={account.password} onChange={set('password')} onBlur={touch('password')}
                invalid={!!err('password')} autoComplete="new-password" />
            </Field>
            <Field label="Confirm password" htmlFor="r-confirm" error={err('confirm')}>
              <Input id="r-confirm" type="password" value={account.confirm} onChange={set('confirm')} onBlur={touch('confirm')}
                invalid={!!err('confirm')} autoComplete="new-password" />
            </Field>
          </div>
        </div>
        <div className="flex justify-end border-t border-white/[0.06] px-6 py-4">
          <Button type="submit" variant="primary">Send verification code <IconArrowRight className="h-4 w-4" /></Button>
        </div>
      </Card>
    </form>
  );
}
