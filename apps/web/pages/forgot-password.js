import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import AuthShell from '../components/auth/AuthShell';
import { Button, Field, Input, cx } from '../components/ui';
import OtpInput from '../components/ui/OtpInput';
import { IconArrowLeft, IconLock, IconMail, IconShield } from '../components/ui/icons';
import { api } from '../lib/api';

// Forgot password, four steps:
//   1. email → 2. code sent → 3. enter the 6-digit code → 4. new password → /login?reset=1
// The API answers step 1 the same way whether or not the email has an
// account, locks a code after 5 wrong tries, and signs the account out of
// every existing session once the password changes.
const MIN_PASSWORD_LEN = 10;
const RESEND_SECONDS = 30;

export default function ForgotPassword() {
  const router = useRouter();
  const [step, setStep] = useState('email'); // email | code | password
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [resetToken, setResetToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!cooldown) return undefined;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = (e) => {
    e?.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter the email you signed up with.');
    run(async () => {
      const r = await api.requestResetCode(email.trim());
      setNotice(r.message);
      setCode(['', '', '', '', '', '']);
      setStep('code');
      setCooldown(RESEND_SECONDS);
    });
  };

  const verify = (e) => {
    e?.preventDefault();
    const joined = code.join('');
    if (joined.length !== 6) return setError('Enter all 6 digits.');
    run(async () => {
      const r = await api.verifyResetCode(email.trim(), joined);
      setResetToken(r.resetToken);
      setStep('password');
    });
  };

  const save = (e) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LEN) return setError(`Use at least ${MIN_PASSWORD_LEN} characters.`);
    if (password !== confirm) return setError("Passwords don't match.");
    run(async () => {
      await api.resetPassword(resetToken, password);
      router.push('/login?reset=1');
    });
  };

  const stepIndex = { email: 0, code: 1, password: 2 }[step];
  const copy = {
    email: ['Reset your password', 'Enter the email you use to sign in and we’ll send you a 6-digit code.'],
    code: ['Check your email', `Enter the 6-digit code sent to ${email.trim()}. It expires in 10 minutes.`],
    password: ['Choose a new password', 'You’ll be signed out everywhere else once it’s saved.']
  }[step];

  return (
    <AuthShell title="Reset password" heading={copy[0]} subheading={copy[1]}
      footer={<Link href="/login" className="inline-flex items-center gap-1.5 font-medium text-fg-2 hover:text-fg"><IconArrowLeft className="h-4 w-4" />Back to sign in</Link>}>
      <ol className="mb-6 grid grid-cols-3 gap-2" aria-label="Progress">
        {[['Email', IconMail], ['Code', IconShield], ['Password', IconLock]].map(([label, Icon], i) => (
          <li key={label} className="flex flex-col items-center gap-1.5">
            <span className={cx('h-1 w-full rounded-full', i <= stepIndex ? 'bg-gradient-to-r from-brand-400 to-green-400' : 'bg-white/10')} />
            <span className={cx('flex items-center gap-1 text-[11px]', i === stepIndex ? 'text-fg' : 'text-fg-3')}><Icon className="h-3 w-3" />{label}</span>
          </li>
        ))}
      </ol>

      {step === 'email' && (
        <form onSubmit={sendCode} className="space-y-4" noValidate>
          <Field label="Work email" htmlFor="reset-email">
            <Input id="reset-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>Send code</Button>
        </form>
      )}

      {step === 'code' && (
        <form onSubmit={verify} className="space-y-4" noValidate>
          {notice && <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[13px] text-fg-2">{notice}</p>}
          <OtpInput value={code} onChange={setCode} onComplete={() => {}} disabled={busy} />
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={code.join('').length !== 6}>Verify code</Button>
          <div className="flex items-center justify-between text-xs">
            <button type="button" className="text-fg-3 hover:text-fg-2" onClick={() => { setStep('email'); setError(''); }}>Use a different email</button>
            <button type="button" className="font-medium text-brand-300 hover:text-brand-200 disabled:text-fg-3" disabled={cooldown > 0 || busy} onClick={sendCode}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
          </div>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={save} className="space-y-4" noValidate>
          <Field label="New password" htmlFor="new-password" hint={`At least ${MIN_PASSWORD_LEN} characters.`}>
            <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm-password">
            <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>Save password</Button>
        </form>
      )}
    </AuthShell>
  );
}

function ErrorNote({ children }) {
  return <p className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-100" role="alert">{children}</p>;
}

