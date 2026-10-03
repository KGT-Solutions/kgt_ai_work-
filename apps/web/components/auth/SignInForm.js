import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { getToken, setToken } from '../../lib/api';
import { Button, Field, Input } from '../ui';
import { IconCheck } from '../ui/icons';

// Email + password form shared by client and staff sign-in. `kind` picks the
// session it creates; `signIn` calls the matching API; `checkSession`
// resolves when an existing session of that kind is still valid (then we
// skip the form). Honors ?next= from the shell's redirect, same-site only.
export default function SignInForm({ kind, signIn, checkSession, destination, forgotHref }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const next = typeof router.query.next === 'string' && router.query.next.startsWith('/') && !router.query.next.startsWith('//')
    ? router.query.next : destination;

  useEffect(() => {
    if (!router.isReady || !getToken(kind)) return;
    checkSession().then(() => router.replace(next)).catch(() => setToken(kind, null));
  }, [router.isReady]);

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const { token } = await signIn(email.trim(), password);
      setToken(kind, token);
      router.push(next);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {router.query.reset === '1' && (
        <p className="flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-[13px] text-emerald-100" role="status">
          <IconCheck className="h-4 w-4 text-emerald-300" /> Password updated — sign in with your new password.
        </p>
      )}
      <Field label="Email" htmlFor={`${kind}-email`}>
        <Input id={`${kind}-email`} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus />
      </Field>
      <Field label={
        <span className="flex items-center justify-between">
          <span>Password</span>
          {forgotHref && <Link href={forgotHref} className="text-xs font-medium text-brand-300 hover:text-brand-200">Forgot password?</Link>}
        </span>
      } htmlFor={`${kind}-password`}>
        <Input id={`${kind}-password`} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <p className="rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-100" role="alert">{error}</p>}
      <Button type="submit" variant="primary" className="w-full" loading={loading} disabled={!email.trim() || !password}>Sign in</Button>
    </form>
  );
}
