import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { api, setToken } from '../lib/api';
import { showError, showSuccess } from './AppAlert';
import BrandHeader, { BrandMobileMark } from './BrandHeader';
import { PageSkeleton } from './Skeleton';

// Signed-in shell for both audiences. Checks its own session once on mount,
// sends the visitor to the right sign-in page when it's missing or expired,
// and never renders children before the session is confirmed — so a client
// can't see staff pages (or the reverse) even for a frame.
//
//   staff  — KGT platform staff, /admin/*   (operator session)
//   client — one customer company, /dashboard (client session)
const AUDIENCES = {
  staff: {
    tokenKind: 'operator',
    loginPath: '/admin/login',
    role: 'Staff console',
    me: () => api.staffMe().then((r) => ({ name: r.operator.name, email: r.operator.email, operator: r.operator })),
    nav: [
      { href: '/admin', label: 'All companies', match: (p) => p === '/admin' || (p.startsWith('/admin/tenants/') && p !== '/admin/tenants/new') },
      { href: '/admin/tenants/new', label: 'New company', match: (p) => p === '/admin/tenants/new' },
      { href: '/register', label: 'Public signup page', match: () => false }
    ]
  },
  client: {
    tokenKind: 'client',
    loginPath: '/login',
    role: 'Your AI workspace',
    me: () => api.clientMe().then((r) => ({ name: r.user.name || r.tenant.name, email: r.user.email, user: r.user, tenant: r.tenant })),
    nav: [{ href: '/dashboard', label: 'Dashboard', match: (p) => p === '/dashboard' }]
  }
};

/**
 * @param {{ audience: 'staff'|'client', title?: string, subtitle?: string, error?, success?, loading?: boolean,
 *           onSession?: (session: object) => void, children }} props
 *   error/success: a string, or { message } — pass a fresh object to show the same message again.
 */
export default function AppLayout({ audience, title, subtitle, children, error, success, loading, onSession }) {
  const config = AUDIENCES[audience];
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const lastError = useRef('');
  const lastSuccess = useRef('');

  useEffect(() => {
    if (error && error !== lastError.current) {
      lastError.current = error;
      showError(typeof error === 'string' ? error : error.message);
    }
    if (!error) lastError.current = '';
  }, [error]);

  useEffect(() => {
    if (success && success !== lastSuccess.current) {
      lastSuccess.current = success;
      showSuccess(typeof success === 'string' ? success : success.message);
    }
    if (!success) lastSuccess.current = '';
  }, [success]);

  useEffect(() => {
    config.me()
      .then((s) => {
        setSession(s);
        onSession?.(s);
      })
      .catch((err) => {
        if (err.status === 403) showError(err.message, 'Account unavailable');
        setToken(config.tokenKind, null);
        router.replace(config.loginPath);
      });
  }, [audience]);

  useEffect(() => { setSidebarOpen(false); }, [router.asPath]);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  const logout = () => {
    setToken(config.tokenKind, null);
    router.push(config.loginPath);
  };

  const currentPath = router.asPath.split('?')[0];

  return (
    <div className="admin-onboard-shell">
      <Head>
        <title>{title ? `${title} — KGT AI Hub` : 'KGT AI Hub'}</title>
      </Head>
      <div className="admin-onboard-atmosphere" aria-hidden="true" />
      <div className={`admin-overlay${sidebarOpen ? ' is-visible' : ''}`} onClick={() => setSidebarOpen(false)} aria-hidden={!sidebarOpen} />

      <header className="admin-mobile-bar admin-onboard-mobile-bar">
        <button type="button" className="admin-menu-btn" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}>
          {sidebarOpen ? '×' : '☰'}
        </button>
        <BrandMobileMark />
        <span className="admin-mobile-title">{title || config.role}</span>
      </header>

      <aside className={`admin-onboard-sidebar${sidebarOpen ? ' is-open' : ''}`}>
        <div className="admin-onboard-brand">
          <div className="admin-onboard-mark" aria-hidden="true">K</div>
          <div className="admin-onboard-brand-text">
            <h2 className="admin-onboard-brand-name">KGT AI Hub</h2>
            <p className="admin-onboard-brand-role">{config.role}</p>
          </div>
        </div>

        <nav className="admin-onboard-nav" aria-label={config.role}>
          {config.nav.map((item) => (
            <Link key={item.href} href={item.href} className={`admin-onboard-nav-link${item.match(currentPath) ? ' is-active' : ''}`}
              onClick={() => setSidebarOpen(false)}>
              {item.label}
            </Link>
          ))}
        </nav>

        {session && (
          <div className="admin-onboard-user">
            <p className="admin-onboard-user-name">{session.name}</p>
            <p className="admin-onboard-user-phone">{session.email}</p>
            <button type="button" className="admin-onboard-logout" onClick={logout}>Log out</button>
          </div>
        )}
      </aside>

      <main className="admin-onboard-main">
        <BrandHeader role={audience === 'staff' ? 'KGT staff' : session?.tenant?.name} />
        <div className="admin-onboard-body">
          {!session ? (
            <PageSkeleton variant="list" />
          ) : (
            <>
              {title && <h1 className="admin-onboard-title">{title}</h1>}
              {subtitle && <p className="admin-onboard-subtitle">{subtitle}</p>}
              {loading ? <PageSkeleton variant="list" /> : children}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
