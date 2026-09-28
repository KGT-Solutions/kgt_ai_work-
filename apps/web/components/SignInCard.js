import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { getToken, setToken } from '../lib/api';
import { showError } from './AppAlert';

// Email + password sign-in, shared by the client login (/login) and the KGT
// staff login (/admin/login). `kind` picks which session it creates;
// `signIn(email, password)` calls the matching API; `checkSession()` resolves
// if an existing session of that kind is still valid.
export default function SignInCard({ kind, title, tagline, signIn, checkSession, destination, footer }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Already signed in: go straight to the destination.
  useEffect(() => {
    if (!getToken(kind)) return;
    checkSession().then(() => router.replace(destination)).catch(() => setToken(kind, null));
  }, [router]);

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const { token } = await signIn(email.trim(), password);
      setToken(kind, token);
      router.push(destination);
    } catch (err) {
      showError(err.message, 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-login-wrap">
      <Head>
        <title>{`${title} — KGT AI Hub`}</title>
      </Head>
      <div className="admin-login-atmosphere" aria-hidden="true" />

      <div className="admin-login-card">
        <div className="admin-login-brand">
          <h1 className="admin-login-brand-name">{title}</h1>
          <p className="admin-login-tagline">{tagline}</p>
        </div>

        <form className="admin-login-form" onSubmit={submit}>
          <label className="admin-login-label" htmlFor={`${kind}-email`}>Email</label>
          <input id={`${kind}-email`} className="admin-login-input" type="email" placeholder="you@company.com"
            autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />

          <label className="admin-login-label" htmlFor={`${kind}-password`}>Password</label>
          <input id={`${kind}-password`} className="admin-login-input" type="password" placeholder="Enter password"
            autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />

          <button type="submit" className="admin-login-cta" disabled={loading || !email.trim() || !password}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {footer && <p className="admin-login-helper">{footer}</p>}
      </div>
    </div>
  );
}
