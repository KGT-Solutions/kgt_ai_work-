import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { showError, showSuccess } from './AppAlert';
import BrandHeader, { BrandMobileMark } from './BrandHeader';
import { PageSkeleton } from './Skeleton';

const NAV = [
  { href: '/buildings', label: 'Buildings', match: (path) => path === '/buildings' || path === '/buildings/' },
  { href: '/buildings/new', label: 'Onboard society', match: (path) => path.startsWith('/buildings/new') },
  { href: '/bugs', label: 'Bug reports', match: (path) => path === '/bugs' || path.startsWith('/bugs/') },
  { href: '/sales-leads', label: 'Sales leads', match: (path) => path === '/sales-leads' },
  { href: '/tenants', label: 'Tenants', match: (path) => path === '/tenants' || path.startsWith('/tenants/') }
];

export default function SuperAdminLayout({ title, subtitle, children, error, success, loading }) {
  const router = useRouter();
  const [authUser, setAuthUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const lastError = useRef('');
  const lastSuccess = useRef('');

  useEffect(() => {
    if (error && error !== lastError.current) {
      lastError.current = error;
      showError(error);
    }
    if (!error) lastError.current = '';
  }, [error]);

  useEffect(() => {
    if (success && success !== lastSuccess.current) {
      lastSuccess.current = success;
      showSuccess(success);
    }
    if (!success) lastSuccess.current = '';
  }, [success]);

  useEffect(() => {
    if (authError) showError(authError, 'Access restricted');
  }, [authError]);

  useEffect(() => {
    (async () => {
      try {
        const { user } = await api.getMe();
        setAuthUser(user);
        if (!user.isSuperAdmin) {
          setAuthError(`You are signed in as ${user.name} (Building Admin). This page is Super Admin only. Log out and sign in with the Super Admin phone.`);
        }
      } catch {
        router.replace('/login');
      } finally {
        setAuthChecked(true);
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
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('user');
    window.localStorage.removeItem('memberships');
    router.push('/login');
  };

  const currentPath = router.asPath.split('?')[0];

  return (
    <div className="admin-onboard-shell">
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
        <span className="admin-mobile-title">{title || 'Super Admin'}</span>
      </header>

      <aside className={`admin-onboard-sidebar${sidebarOpen ? ' is-open' : ''}`}>
        <div className="admin-onboard-brand">
          <img
            src="/brand/icon-color.png"
            alt=""
            className="admin-onboard-mark-img"
            aria-hidden="true"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const fallback = e.currentTarget.nextElementSibling;
              if (fallback) fallback.hidden = false;
            }}
          />
          <div className="admin-onboard-mark" hidden aria-hidden="true">F</div>
          <div className="admin-onboard-brand-text">
            <h2 className="admin-onboard-brand-name">Super Admin</h2>
            <p className="admin-onboard-brand-role">Console</p>
          </div>
        </div>

        <nav className="admin-onboard-nav" aria-label="Super admin">
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

        {authUser && (
          <div className="admin-onboard-user">
            <p className="admin-onboard-user-name">{authUser.name}</p>
            <p className="admin-onboard-user-phone">{authUser.phone}</p>
            <button type="button" className="admin-onboard-logout" onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </aside>

      <main className="admin-onboard-main">
        <BrandHeader role="Super admin" />

        <div className="admin-onboard-body">
          {!authChecked ? (
            <PageSkeleton variant="list" />
          ) : (
            <>
              {title && <h1 className="admin-onboard-title">{title}</h1>}
              {subtitle && <p className="admin-onboard-subtitle">{subtitle}</p>}
              {!authError && (loading ? <PageSkeleton variant="list" /> : children)}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
