import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { api, getToken, setSession } from '../lib/api';
import { showError } from '../components/AppAlert';

// Operator console sign-in. Operators are created by the API's seed script
// (HUB_ADMIN_EMAIL / HUB_ADMIN_PASSWORD); there is no self-registration here —
// companies sign up through /register instead.
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // Already signed in: skip straight to the console.
  useEffect(() => {
    if (!getToken()) return;
    api.getMe().then(() => router.replace('/tenants')).catch(() => setSession(null));
  }, [router]);

  const submit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    try {
      const { token } = await api.login(email.trim(), password);
      setSession(token);
      router.push('/tenants');
    } catch (err) {
      showError(err.message, 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = email.trim() && password;

  return (
    <div className="admin-login-wrap">
      <Head>
        <title>Sign in — KGT AI Hub</title>
      </Head>
      <div className="admin-login-atmosphere" aria-hidden="true" />

      <div className="admin-login-card">
        <div className="admin-login-brand">
          <h1 className="admin-login-brand-name">KGT AI Hub</h1>
          <p className="admin-login-tagline">Operator console for tenants, knowledge and bots</p>
        </div>

        <form className="admin-login-form" onSubmit={submit}>
          <label className="admin-login-label" htmlFor="operator-email">
            Email
          </label>
          <input
            id="operator-email"
            className="admin-login-input"
            type="email"
            placeholder="you@company.com"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <label className="admin-login-label" htmlFor="operator-password">
            Password
          </label>
          <input
            id="operator-password"
            className="admin-login-input"
            type="password"
            placeholder="Enter password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <button type="submit" className="admin-login-cta" disabled={loading || !canSubmit}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="admin-login-helper">
          A company looking to sign up? <a href="/register">Start onboarding</a>
        </p>
      </div>
    </div>
  );
}
