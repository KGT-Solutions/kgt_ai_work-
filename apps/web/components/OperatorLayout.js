import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { api, setSession } from '../lib/api';
import { showError, showSuccess } from './AppAlert';
import BrandHeader, { BrandMobileMark } from './BrandHeader';
import { PageSkeleton } from './Skeleton';

const NAV = [
  { href: '/tenants', label: 'Tenants', match: (path) => path === '/tenants' || (path.startsWith('/tenants/') && path !== '/tenants/new') },
  { href: '/tenants/new', label: 'New tenant', match: (path) => path === '/tenants/new' },
  { href: '/register', label: 'Public signup page', match: () => false }
];

// Shell for every operator-only page: checks the session once, redirects to
// /login when it's missing or expired, and shows the tenant navigation.
export default function OperatorLayout({ title, subtitle, children, error, success, loading }) {
  const router = useRouter();
  const [operator, setOperator] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const lastError = useRef('');
  const lastSuccess = useRef('');

  // error/success: a string, or { message } — pages that can repeat the same
  // message pass a fresh object each time so it's shown again.
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
    (async () => {
      try {
        const { operator: me } = await api.getMe();
        setOperator(me);
        setAuthChecked(true);
      } catch {
        setSession(null);
        router.replace('/login');
      }
    })();
  }, [router]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [router.asPath]);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  const logout = () => {
    setSession(null);
    router.push('/login');
  };

  const currentPath = router.asPath.split('?')[0];

  return (
    <div className="admin-onboard-shell">
      <Head>
        <title>{title ? `${title} — KGT AI Hub` : 'KGT AI Hub'}</title>
      </Head>
      <div className="admin-onboard-atmosphere" aria-hidden="true" />

      <div
        className={`admin-overlay${sidebarOpen ? ' is-visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
      />

      <header className="admin-mobile-bar admin-onboard-mobile-bar">
        <button
          type="button"
          className="admin-menu-btn"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        >
          {sidebarOpen ? '×' : '☰'}
        </button>
        <BrandMobileMark />
        <span className="admin-mobile-title">{title || 'Operator console'}</span>
      </header>

      <aside className={`admin-onboard-sidebar${sidebarOpen ? ' is-open' : ''}`}>
        <div className="admin-onboard-brand">
          <div className="admin-onboard-mark" aria-hidden="true">K</div>
          <div className="admin-onboard-brand-text">
            <h2 className="admin-onboard-brand-name">KGT AI Hub</h2>
            <p className="admin-onboard-brand-role">Operator console</p>
          </div>
        </div>

        <nav className="admin-onboard-nav" aria-label="Operator">
          {NAV.map((item) => {
            const active = item.match(currentPath);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`admin-onboard-nav-link${active ? ' is-active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {operator && (
          <div className="admin-onboard-user">
            <p className="admin-onboard-user-name">{operator.name}</p>
            <p className="admin-onboard-user-phone">{operator.email}</p>
            <button type="button" className="admin-onboard-logout" onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </aside>

      <main className="admin-onboard-main">
        <BrandHeader role="Operator" />

        <div className="admin-onboard-body">
          {!authChecked ? (
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
