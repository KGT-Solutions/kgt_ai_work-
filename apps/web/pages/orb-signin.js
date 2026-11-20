import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { api, getToken, setToken } from '../lib/api';
import { OrbAuthShell, OrbFormCard } from '../components/orb/auth';
import { Field, Input, Button } from '../components/orb';

// Orb-styled client sign-in. Copies the existing login flow (lib/api clientLogin
// + clientMe, kgtClientToken in localStorage), just with the Orb look and a
// /overview destination. Honors ?next= (same-site only); skips the form if a
// valid session already exists.
export default function OrbSignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const next = typeof router.query.next === 'string' && router.query.next.startsWith('/') && !router.query.next.startsWith('//')
    ? router.query.next : '/overview';

  useEffect(() => {
    if (!router.isReady || !getToken('client')) return;
    api.clientMe().then(() => router.replace(next)).catch(() => setToken('client', null));
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const { token } = await api.clientLogin(email.trim(), password);
      setToken('client', token);
      router.push(next);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const topRight = (
    <span className="orb-small text-orb-secondary">
      New to Orb? <Link href="/orb-register" className="orb-small-medium text-orb-ink underline">Create an account</Link>
    </span>
  );
  const disabled = !email.trim() || !password;

  return (
    <>
      <Head><title>Log in · Orb</title></Head>
      <OrbAuthShell right={topRight}>
        <div className="flex flex-col items-center gap-7 pt-8">
          <div className="text-center">
            <h1 className="orb-page-title text-orb-ink">Welcome back</h1>
            <p className="mt-1.5 orb-body text-orb-secondary">Log in to your Orb console.</p>
          </div>

          <OrbFormCard
            title="Log in"
            subtitle="Use the email and password you signed up with."
            footer={(
              <div className="flex justify-end">
                <Button type="submit" form="orb-signin-form" variant="primary" size="md" disabled={disabled} className={disabled ? 'opacity-45' : ''}>
                  {loading ? 'Logging in…' : 'Log in'}
                </Button>
              </div>
            )}
          >
            <form id="orb-signin-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
              <Field label="Email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@clinic.com" autoFocus /></Field>
              <Field label="Password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
              {error && <p className="rounded-lg bg-orb-subtle px-3 py-2 orb-small text-orb-ink" role="alert">{error}</p>}
            </form>
          </OrbFormCard>
        </div>
      </OrbAuthShell>
    </>
  );
}
