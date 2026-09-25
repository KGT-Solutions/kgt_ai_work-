import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { readStoredAdminMemberships } from '../lib/memberships';
import { colors, radius, font } from '../lib/theme';
import { showError, showSuccess } from './AppAlert';
import BrandHeader, { BrandMobileMark } from './BrandHeader';
import { PageSkeleton } from './Skeleton';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', path: '' },
  { key: 'residents', label: 'Resident approvals', path: '/residents' },
  { key: 'complaints', label: 'Complaints', path: '/complaints' },
  { key: 'announcements', label: 'Announcements', path: '/announcements' },
  { key: 'votes', label: 'Polls & votes', path: '/votes' },
  { key: 'maintenance', label: 'Finance', path: '/maintenance' },
  { key: 'flats', label: 'Flats', path: '/flats' },
  { key: 'visitors', label: 'Visitors', path: '/visitors' },
  { key: 'vehicles', label: 'Vehicles', path: '/vehicles' },
  { key: 'facilities', label: 'Facilities', path: '/facilities' },
  { key: 'directory', label: 'Directory', path: '/directory' },
  { key: 'bugs', label: 'Report a bug', path: '/bugs' }
];

const CATEGORY_HREF = {
  complaint: '/complaints',
  approval: '/residents',
  family: '/flats',
  facility: '/facilities',
  vehicle: '/vehicles',
  bill: '/maintenance'
};

function hrefForNotification(buildingId, n) {
  const path = CATEGORY_HREF[n.category] || '';
  return `/dashboard/${buildingId}${path}`;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function BellButton({ unreadCount, onClick }) {
  return (
    <button
      type="button"
      className="admin-bell-btn"
      aria-label={unreadCount ? `${unreadCount} unread notifications` : 'Notifications'}
      onClick={onClick}
    >
      <span aria-hidden className="admin-bell-icon">🔔</span>
      {unreadCount > 0 && (
        <span className="admin-bell-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
      )}
    </button>
  );
}

export default function AdminLayout({ buildingId, title, children, error, success, loading, skeletonVariant = 'dashboard' }) {
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingFamily, setPendingFamily] = useState(0);
  const [pendingBookings, setPendingBookings] = useState(0);
  const [pendingVehicles, setPendingVehicles] = useState(0);
  const [openComplaints, setOpenComplaints] = useState(0);
  const [buildingName, setBuildingName] = useState('');
  const [buildingCode, setBuildingCode] = useState('');
  const [canSwitchSociety, setCanSwitchSociety] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
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

  const refreshBadges = useCallback(() => {
    if (!buildingId) return;
    api.getApprovals(buildingId).then((items) => setPendingCount(items.length)).catch(() => {});
    api.getPendingFamilyCount(buildingId).then((r) => setPendingFamily(r.count || 0)).catch(() => {});
    api.getFacilityBookings(buildingId, 'pending').then((items) => setPendingBookings(items.length)).catch(() => {});
    api.getPendingVehicleCount(buildingId).then((r) => setPendingVehicles(r.count || 0)).catch(() => {});
    api.getOpenComplaintCount(buildingId).then((r) => setOpenComplaints(r.count || 0)).catch(() => {});
  }, [buildingId]);

  const refreshNotifications = useCallback(async () => {
    if (!buildingId) return;
    try {
      const [countRes, list] = await Promise.all([
        api.getUnreadNotificationCount(buildingId),
        api.getNotifications(buildingId)
      ]);
      setUnreadCount(countRes.count || 0);
      setNotifications(list || []);
      if ((countRes.count || 0) > 0) setBannerDismissed(false);
    } catch {
      /* ignore */
    }
  }, [buildingId]);

  useEffect(() => {
    if (!buildingId) return;
    refreshBadges();
    refreshNotifications();
    const memberships = readStoredAdminMemberships();
    setCanSwitchSociety(memberships.length > 1);
    const match = memberships.find((m) => m.buildingId === buildingId);
    if (match) {
      setBuildingName(match.buildingName);
      setBuildingCode(match.buildingCode || '');
    }
    api.getDashboard(buildingId)
      .then((d) => {
        if (d?.building?.name) setBuildingName(d.building.name);
        if (d?.building?.buildingCode) setBuildingCode(d.building.buildingCode);
      })
      .catch(() => {});
  }, [buildingId, refreshBadges, refreshNotifications]);

  useEffect(() => {
    if (!buildingId) return undefined;
    const id = setInterval(() => {
      refreshNotifications();
      refreshBadges();
    }, 30000);
    return () => clearInterval(id);
  }, [buildingId, refreshNotifications, refreshBadges]);

  useEffect(() => {
    setSidebarOpen(false);
    setPanelOpen(false);
  }, [router.asPath]);

  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [sidebarOpen]);

  useEffect(() => {
    if (!panelOpen) return undefined;
    const onDoc = (e) => {
      if (e.target.closest('.admin-bell-btn') || e.target.closest('.admin-notif-panel')) return;
      setPanelOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [panelOpen]);

  const base = `/dashboard/${buildingId}`;
  const currentPath = router.asPath.split('?')[0];

  const logout = () => {
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('user');
    window.localStorage.removeItem('memberships');
    router.push('/login');
  };

  const closeSidebar = () => setSidebarOpen(false);

  const unreadList = notifications.filter((n) => !n.read);
  const latestUnread = unreadList[0];
  const showBanner = !bannerDismissed && unreadCount > 0 && latestUnread;

  const openPanel = () => {
    setPanelOpen((o) => {
      if (!o) refreshNotifications();
      return !o;
    });
  };

  const openNotification = async (n) => {
    try {
      if (!n.read) await api.markNotificationRead(buildingId, n.id);
    } catch {
      /* ignore */
    }
    setPanelOpen(false);
    await refreshNotifications();
    router.push(hrefForNotification(buildingId, n));
  };

  const markAllRead = async () => {
    try {
      await api.markAllNotificationsRead(buildingId);
      await refreshNotifications();
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="admin-shell">
      <div className="admin-shell-atmosphere" aria-hidden="true" />

      <div
        className={`admin-overlay${sidebarOpen ? ' is-visible' : ''}`}
        onClick={closeSidebar}
        aria-hidden={!sidebarOpen}
      />

      <header className="admin-mobile-bar">
        <button
          type="button"
          className="admin-menu-btn"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        >
          {sidebarOpen ? '×' : '☰'}
        </button>
        <BrandMobileMark />
        <span className="admin-mobile-title">{buildingName || title || 'Society'}</span>
        <div className="admin-mobile-bell">
          <BellButton unreadCount={unreadCount} onClick={openPanel} />
        </div>
      </header>

      <aside className={`admin-sidebar${sidebarOpen ? ' is-open' : ''}`}>
        <div className="admin-sidebar-brand">
          <img
            src="/brand/icon-color.png"
            alt=""
            className="admin-sidebar-mark-img"
            aria-hidden="true"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const fallback = e.currentTarget.nextElementSibling;
              if (fallback) fallback.hidden = false;
            }}
          />
          <div className="admin-sidebar-mark" hidden aria-hidden="true">F</div>
          <div className="admin-sidebar-brand-text">
            <div className="admin-sidebar-brand-name">{buildingName || 'FLATBRIZ'}</div>
            {buildingCode ? <div className="admin-sidebar-code">Code · {buildingCode}</div> : null}
          </div>
        </div>

        <nav className="admin-sidebar-nav" aria-label="Building admin">
          {NAV.map(({ key, label, path }) => {
            const href = `${base}${path}`;
            const active = path ? currentPath === href : currentPath === base;
            const badge = (key === 'residents' && (pendingCount + pendingFamily))
              || (key === 'facilities' && pendingBookings)
              || (key === 'vehicles' && pendingVehicles)
              || (key === 'complaints' && openComplaints);
            return (
              <Link
                key={key}
                href={href}
                className={`admin-sidebar-nav-link${active ? ' is-active' : ''}`}
                onClick={closeSidebar}
              >
                <span>{label}</span>
                {badge > 0 ? <span className="admin-sidebar-badge">{badge}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="admin-sidebar-footer">
          {canSwitchSociety ? (
            <button
              type="button"
              className="admin-sidebar-switch"
              onClick={() => router.push('/select-society')}
            >
              Switch society
            </button>
          ) : null}
          <button type="button" className="admin-sidebar-logout" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <BrandHeader
          role="Building admin"
          actions={(
            <div className="admin-desktop-bell">
              <BellButton unreadCount={unreadCount} onClick={openPanel} />
            </div>
          )}
        />

        <div className="admin-main-header">
          {title ? <h1 className="admin-page-title">{title}</h1> : null}
        </div>

        {panelOpen && (
          <div className="admin-notif-panel">
            <div className="admin-notif-header">
              <strong>Notifications</strong>
              {unreadCount > 0 && (
                <button type="button" className="admin-notif-mark-all" onClick={markAllRead}>
                  Mark all read
                </button>
              )}
            </div>
            <div className="admin-notif-list">
              {notifications.length === 0 ? (
                <p className="admin-notif-empty">No notifications yet.</p>
              ) : (
                notifications.slice(0, 30).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={`admin-notif-item${!n.read ? ' is-unread' : ''}`}
                    onClick={() => openNotification(n)}
                  >
                    <div className="admin-notif-item-title">{n.title}</div>
                    <div className="admin-notif-item-body">{n.body}</div>
                    <div className="admin-notif-item-meta">
                      {n.category} · {timeAgo(n.createdAt)}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {showBanner && (
          <div className="admin-notif-banner" role="status">
            <div className="admin-notif-banner-copy">
              <div className="admin-notif-banner-title">{latestUnread.title}</div>
              <div className="admin-notif-banner-body">{latestUnread.body}</div>
            </div>
            <button
              type="button"
              className="admin-notif-banner-cta"
              onClick={() => openNotification(latestUnread)}
            >
              View
            </button>
            <button
              type="button"
              className="admin-notif-banner-dismiss"
              aria-label="Dismiss"
              onClick={() => setBannerDismissed(true)}
            >
              ×
            </button>
          </div>
        )}

        {loading ? <PageSkeleton variant={skeletonVariant} /> : children}
      </main>
    </div>
  );
}

export function useBuildingId() {
  const router = useRouter();
  return router.query.buildingId;
}
