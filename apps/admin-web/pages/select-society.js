import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { adminRoleLabel, readStoredAdminMemberships } from '../lib/memberships';

export default function SelectSociety() {
  const router = useRouter();
  const [memberships, setMemberships] = useState([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = window.localStorage.getItem('token');
    let user = null;
    try {
      user = JSON.parse(window.localStorage.getItem('user') || 'null');
    } catch {
      user = null;
    }
    const admin = readStoredAdminMemberships();

    if (!token) {
      router.replace('/login');
      return;
    }
    if (!admin.length) {
      router.replace(user?.isSuperAdmin ? '/buildings' : '/login');
      return;
    }
    if (admin.length === 1) {
      router.replace(`/dashboard/${admin[0].buildingId}`);
      return;
    }

    setMemberships(admin);
    setReady(true);
  }, [router]);

  const openDashboard = (membership) => {
    if (!membership?.buildingId) return;
    router.push(`/dashboard/${membership.buildingId}`);
  };

  const logout = () => {
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('user');
    window.localStorage.removeItem('memberships');
    router.push('/login');
  };

  if (!ready) return null;

  return (
    <div className="admin-login-wrap">
      <div className="admin-login-atmosphere" aria-hidden="true" />

      <div className="admin-select-panel">
        <div className="admin-select-brand">
          <img
            src="/brand/wordmark-color.png"
            alt="FLATBRIZ"
            className="admin-login-wordmark"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const fallback = e.currentTarget.nextElementSibling;
              if (fallback) fallback.hidden = false;
            }}
          />
          <h1 className="admin-login-brand-name" hidden>FLATBRIZ</h1>
          <h2 className="admin-select-title">Choose a society</h2>
          <p className="admin-select-subtitle">
            This number is an admin for more than one society. Open the dashboard you want to manage.
          </p>
        </div>

        <div className="admin-select-grid">
          {memberships.map((m) => (
            <button
              key={m.id}
              type="button"
              className="admin-select-card"
              onClick={() => openDashboard(m)}
            >
              <div className="admin-select-card-mark" aria-hidden="true">
                {(m.buildingName || 'S').charAt(0).toUpperCase()}
              </div>
              <div className="admin-select-card-body">
                <div className="admin-select-card-name">{m.buildingName || 'Society'}</div>
                <div className="admin-select-card-meta">
                  {[m.buildingCode, adminRoleLabel(m.role)].filter(Boolean).join(' · ')}
                </div>
              </div>
              <span className="admin-select-card-go">Open dashboard</span>
            </button>
          ))}
        </div>

        <button type="button" className="admin-login-link" onClick={logout}>
          Log out
        </button>
      </div>
    </div>
  );
}
