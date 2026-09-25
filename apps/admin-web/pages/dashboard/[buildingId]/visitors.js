import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';
import { ui } from '../../../components/ui';
import { api } from '../../../lib/api';

const FILTERS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 days' },
  { key: 'month', label: 'Last 30 days' },
  { key: 'all', label: 'All time' }
];

const STATUS_STYLE = {
  pending: { background: '#FEF3C7', color: '#92400E' },
  inside: { background: '#D1FAE5', color: '#065F46' },
  declined: { background: '#FEE2E2', color: '#991B1B' },
  exited: { background: '#F3F4F6', color: '#4B5563' }
};

export default function VisitorsPage() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [scope, setScope] = useState('all');
  const [visitors, setVisitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (filter = scope) => {
    if (!buildingId) return;
    setLoading(true);
    setError('');
    try {
      setVisitors(await api.getVisitors(buildingId, filter));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(scope);
  }, [buildingId, scope]);

  if (!buildingId) return null;

  return (
    <AdminLayout
      buildingId={buildingId}
      title="Visitors"
      error={error}
      loading={loading && visitors.length === 0}
      skeletonVariant="table"
    >
      <div className="admin-toolbar" style={toolbar}>
        <div style={filters}>
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              style={{ ...filterBtn, ...(scope === key ? filterBtnActive : {}) }}
              onClick={() => setScope(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <span style={count}>
          {loading ? 'Loading…' : `${visitors.length} visitor${visitors.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {!loading && visitors.length === 0 ? (
        <div style={ui.empty}>No visitors found for this period.</div>
      ) : (
        <>
          <div className="admin-visitors-table">
            <div className="admin-visitors-thead">
              <span>Visitor</span>
              <span>Flat</span>
              <span>Purpose</span>
              <span>Entry</span>
              <span>Exit</span>
              <span>Status</span>
            </div>
            {visitors.map((v) => (
              <div key={v.id} className="admin-visitors-row">
                <span style={name}>{v.visitorName}</span>
                <span>{v.flat?.number || '—'}</span>
                <span style={purpose}>{v.purpose}</span>
                <span style={time}>{formatDateTime(v.entryTime)}</span>
                <span style={time}>{v.exitTime ? formatDateTime(v.exitTime) : '—'}</span>
                <span style={{ ...pill, ...(STATUS_STYLE[v.status] || STATUS_STYLE.exited) }}>
                  {v.status}
                </span>
              </div>
            ))}
          </div>

          <div className="admin-visitors-cards">
            {visitors.map((v) => (
              <article key={v.id} className="admin-visitor-card">
                <div className="admin-visitor-card-top">
                  <div className="admin-visitor-card-identity">
                    <h3 className="admin-visitor-card-name">{v.visitorName}</h3>
                    <p className="admin-visitor-card-meta">
                      <span>{v.flat?.number || 'No flat'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="admin-visitor-card-purpose">{v.purpose || '—'}</span>
                    </p>
                  </div>
                  <span
                    className={`admin-visitor-status admin-visitor-status--${v.status || 'exited'}`}
                  >
                    {v.status}
                  </span>
                </div>
                <div className="admin-visitor-card-times">
                  <div>
                    <span className="admin-visitor-card-label">Entry</span>
                    <span className="admin-visitor-card-value">{formatDateTime(v.entryTime)}</span>
                  </div>
                  <div>
                    <span className="admin-visitor-card-label">Exit</span>
                    <span className="admin-visitor-card-value">
                      {v.exitTime ? formatDateTime(v.exitTime) : '—'}
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </AdminLayout>
  );
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const toolbar = { marginBottom: 20 };
const filters = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const filterBtn = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E5E4',
  background: '#fff', color: '#6B7280', fontSize: 13, cursor: 'pointer'
};
const filterBtnActive = { background: '#2B3A4A', color: '#fff', borderColor: '#2B3A4A', fontWeight: 600 };
const count = { fontSize: 14, color: '#6B7280' };
const name = { fontWeight: 600, color: '#2B3A4A' };
const purpose = { color: '#374151' };
const time = { fontSize: 13, color: '#6B7280' };
const pill = { fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, textTransform: 'capitalize', display: 'inline-block' };
