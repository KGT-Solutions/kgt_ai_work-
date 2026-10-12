import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AuthShell from '../components/auth/AuthShell';
import { Button, Field, Input, cx } from '../components/ui';
import OtpInput from '../components/ui/OtpInput';
import { IconArrowLeft, IconCheck, IconLock, IconMail } from '../components/ui/icons';
import { api } from '../lib/api';

// Forgot password, two steps (API: routes/publicAuth.routes.js):
//   1. email -> "Send reset code". An address with no account is told so right
//      away (with a link to sign up) instead of waiting for a code that never comes.
//   2. the 6-digit code + new password -> "Reset password", then a confirmation
//      and an automatic redirect to sign-in.
// The API locks a code after 5 wrong tries, allows a resend after 60s, and
// signs the account out of every other session once the password changes.
const MIN_PASSWORD_LEN = 10; // mirrors the API
const EMPTY = ['', '', '', '', '', ''];
const REDIRECT_SECONDS = 3;

export default function ForgotPassword() {
  const router = useRouter();
  const [step, setStep] = useState('email'); // email | reset | done
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(EMPTY);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [noAccount, setNoAccount] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [redirectIn, setRedirectIn] = useState(REDIRECT_SECONDS);

  useEffect(() => {
    if (!cooldown) return undefined;
    const id = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // After a successful reset: count down, then go to sign-in.
  useEffect(() => {
    if (step !== 'done') return undefined;
    if (redirectIn <= 0) { router.push('/login?reset=1'); return undefined; }
    const id = setTimeout(() => setRedirectIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [step, redirectIn]);

  const sendCode = async (e) => {
    e?.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter the email address you signed up with.');
    setBusy(true);
    setError('');
    setNoAccount(false);
    try {
      const r = await api.requestPasswordReset(email.trim());
      setCode(EMPTY);
      setCooldown(r.resendInSeconds || 60);
      setStep('reset');
    } catch (err) {
      if (err.status === 429 && err.data?.retryAfter) {
        // A code went out moments ago: it's still valid, so go to step 2.
        setCooldown(err.data.retryAfter);
        setStep('reset');
      } else {
        setNoAccount(err.data?.code === 'EMAIL_NOT_FOUND');
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    const otp = code.join('');
    if (otp.length !== 6) return setError('Enter all 6 digits of the code.');
    if (password.length < MIN_PASSWORD_LEN) return setError(`Use at least ${MIN_PASSWORD_LEN} characters for your new password.`);
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    setError('');
    try {
      await api.resetPassword(email.trim(), otp, password);
      setStep('done');
    } catch (err) {
      setError(err.message);
      if (err.data?.field !== 'newPassword') setCode(EMPTY); // a wrong code is retyped; a short password isn't the code's fault
    } finally {
      setBusy(false);
    }
  };

  const copy = {
    email: ['Reset your password', 'Enter the email you sign in with and we’ll send you a 6-digit code.'],
    reset: ['Check your email', `Enter the code sent to ${email.trim()} and choose a new password. The code is valid for 10 minutes.`],
    done: ['Password updated', 'You’ve been signed out everywhere else. Sign in with your new password.']
  }[step];
  const stepIndex = { email: 0, reset: 1, done: 2 }[step];

  return (
    <AuthShell title="Reset password" heading={copy[0]} subheading={copy[1]}
      footer={<Link href="/login" className="inline-flex items-center gap-1.5 font-medium text-fg-2 hover:text-fg"><IconArrowLeft className="h-4 w-4" />Back to sign in</Link>}>
      <ol className="mb-6 grid grid-cols-2 gap-2" aria-label="Progress">
        {[['Email', IconMail], ['New password', IconLock]].map(([label, Icon], i) => (
          <li key={label} className="flex flex-col items-center gap-1.5">
            <span className={cx('h-1 w-full rounded-full', i <= stepIndex ? 'bg-gradient-to-r from-brand-400 to-green-400' : 'bg-white/10')} />
            <span className={cx('flex items-center gap-1 text-[11px]', i === stepIndex ? 'text-fg' : 'text-fg-3')}><Icon className="h-3 w-3" />{label}</span>
          </li>
        ))}
      </ol>

      {step === 'email' && (
        <form onSubmit={sendCode} className="space-y-4" noValidate>
          <Field label="Work email" htmlFor="reset-email">
            <Input id="reset-email" type="email" autoComplete="email" value={email} invalid={noAccount}
              onChange={(e) => { setEmail(e.target.value); setNoAccount(false); }} placeholder="you@company.com" autoFocus />
          </Field>
          {error && (
            <ErrorNote>
              {error}{' '}
              {noAccount && <>Check the spelling, or <Link href="/register" className="font-medium underline">create an account</Link>.</>}
            </ErrorNote>
          )}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>Send Reset OTP</Button>
        </form>
      )}

      {step === 'reset' && (
        <form onSubmit={save} className="space-y-4" noValidate>
          <Field label="6-digit code">
            <OtpInput value={code} onChange={setCode} disabled={busy} invalid={!!error && /code/i.test(error)} />
          </Field>
          <Field label="New password" htmlFor="new-password" hint={`At least ${MIN_PASSWORD_LEN} characters.`}>
            <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password">
            <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}
            disabled={code.join('').length !== 6 || !password || !confirm}>Reset password</Button>
          <div className="flex items-center justify-between text-xs">
            <button type="button" className="text-fg-3 hover:text-fg-2" onClick={() => { setStep('email'); setError(''); }}>Use a different email</button>
            <button type="button" className="font-medium text-brand-300 hover:text-brand-200 disabled:text-fg-3" disabled={cooldown > 0 || busy} onClick={sendCode}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      {step === 'done' && (
        <div className="space-y-4 text-center" role="status">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
            <IconCheck className="h-6 w-6" />
          </span>
          <p className="text-sm text-fg-2">Your password has been reset. Taking you to sign in{redirectIn > 0 ? ` in ${redirectIn}s` : ''}…</p>
          <Link href="/login?reset=1" className="inline-block text-sm font-medium text-brand-300 hover:text-brand-200">Sign in now</Link>
        </div>
      )}
    </AuthShell>
  );
}

function ErrorNote({ children }) {
  return <p className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-100" role="alert">{children}</p>;
}
