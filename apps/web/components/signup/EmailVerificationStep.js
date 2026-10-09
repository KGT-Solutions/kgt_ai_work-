import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, cx } from '../ui';
import OtpInput from '../ui/OtpInput';
import { IconArrowLeft, IconArrowRight, IconCheck, IconMail, IconPencil, IconShield } from '../ui/icons';
import { api } from '../../lib/api';

// Signup wizard step: prove the sign-in email is yours before anything is
// built. Sends a 6-digit code on arrival (API: routes/publicAuth.routes.js),
// auto-verifies once six digits are in, and hands the resulting token up via
// onVerified({ email, token }) — /register/complete refuses to create the
// account without it. The resend countdown follows the API's own cooldown.

const EMPTY = ['', '', '', '', '', ''];

export default function EmailVerificationStep({ email, verified, onVerified, onChangeEmail, onNext }) {
  const [code, setCode] = useState(EMPTY);
  const [phase, setPhase] = useState(verified ? 'done' : 'idle'); // idle | sending | sent | verifying | done
  const [error, setError] = useState('');
  const [accountExists, setAccountExists] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const sentFor = useRef(null);

  useEffect(() => {
    if (!cooldown) return undefined;
    const t = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = useCallback(async () => {
    setError('');
    setPhase('sending');
    try {
      const r = await api.sendSignupOtp(email);
      sentFor.current = email;
      setCode(EMPTY);
      setCooldown(r.resendInSeconds || 60);
      setPhase('sent');
    } catch (err) {
      if (err.status === 429 && err.data?.retryAfter) {
        // A code went out moments ago (e.g. after stepping back): it's still valid.
        sentFor.current = email;
        setCooldown(err.data.retryAfter);
        setPhase('sent');
        setError('');
        return;
      }
      setAccountExists(err.status === 409);
      setError(err.message);
      setPhase(sentFor.current === email ? 'sent' : 'idle');
    }
  }, [email]);

  // Send on arrival, once per address.
  useEffect(() => { if (!verified && sentFor.current !== email) send(); }, [email, verified, send]);

  const verify = async (digits = code) => {
    const otp = digits.join('');
    if (otp.length !== 6 || phase === 'verifying') return;
    setError('');
    setPhase('verifying');
    try {
      const r = await api.verifySignupOtp(email, otp);
      setPhase('done');
      onVerified({ email: r.email, token: r.verificationToken });
    } catch (err) {
      setError(err.message);
      setCode(EMPTY);
      setPhase('sent');
    }
  };

  const onCodeChange = (next) => {
    setCode(next);
    if (next.every(Boolean)) verify(next); // auto-submit on the sixth digit
  };

  const done = verified || phase === 'done';

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader icon={<IconShield className="h-4 w-4" />} title="Verify your email"
          description="We'll send a 6-digit code to make sure this address is yours. It protects your account and the bots you're about to create." />
        <div className="space-y-5 p-6">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
            <span className="flex min-w-0 items-center gap-2.5">
              <IconMail className="h-4 w-4 shrink-0 text-fg-3" />
              <span className="truncate text-sm font-medium text-fg">{email}</span>
            </span>
            {done ? <Badge tone="success"><IconCheck className="h-3 w-3" />Verified</Badge> : (
              <button type="button" onClick={onChangeEmail} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand-300 hover:text-brand-200">
                <IconPencil className="h-3.5 w-3.5" />Change
              </button>
            )}
          </div>

          {done ? (
            <div className="flex items-start gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.07] px-4 py-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300"><IconCheck className="h-3.5 w-3.5" /></span>
              <div>
                <p className="text-sm font-medium text-emerald-100">Email verified</p>
                <p className="mt-0.5 text-[13px] text-emerald-200/80">Next, add the knowledge your bots will learn from.</p>
              </div>
            </div>
          ) : (
            <>
              <p className="text-[13px] text-fg-2" aria-live="polite">
                {phase === 'sending' ? 'Sending your code…'
                  : phase === 'idle' ? 'Request a code to continue.'
                    : <>Enter the code we sent to <b className="font-medium text-fg">{email}</b>. It&apos;s valid for 10 minutes.</>}
              </p>
              <OtpInput value={code} onChange={onCodeChange} disabled={phase === 'sending' || phase === 'verifying' || phase === 'idle'} invalid={!!error && phase === 'sent'} />
              {error && (
                <p className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-100" role="alert">
                  {error} {accountExists && <Link href="/login" className="font-medium underline">Sign in</Link>}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[12.5px] text-fg-3">
                  Didn&apos;t get it? Check spam, or{' '}
                  <button type="button" onClick={send} disabled={cooldown > 0 || phase === 'sending' || phase === 'verifying' || accountExists}
                    className="font-medium text-brand-300 hover:text-brand-200 disabled:cursor-not-allowed disabled:text-fg-3">
                    {cooldown > 0 ? `resend in ${cooldown}s` : 'resend the code'}
                  </button>
                </span>
                <Button variant="primary" onClick={() => verify()} loading={phase === 'verifying'} disabled={!code.every(Boolean) || phase !== 'sent'}>
                  Verify code
                </Button>
              </div>
            </>
          )}
        </div>
        <div className={cx('flex flex-col-reverse gap-3 border-t border-white/[0.06] px-6 py-4 sm:flex-row sm:justify-between')}>
          <Button onClick={onChangeEmail}><IconArrowLeft className="h-4 w-4" />Back</Button>
          <Button variant="primary" onClick={onNext} disabled={!done}>Add knowledge <IconArrowRight className="h-4 w-4" /></Button>
        </div>
      </Card>
    </div>
  );
}
