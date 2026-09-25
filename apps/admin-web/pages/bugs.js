import { useEffect, useRef, useState } from 'react';
import SuperAdminLayout from '../components/SuperAdminLayout';
import { ui } from '../components/ui';
import { api, mediaUrl } from '../lib/api';

const STATUSES = ['open', 'in_review', 'resolved'];

export default function BugsInboxPage() {
  const [reports, setReports] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Guards against an out-of-order response: if two load()s are ever in
  // flight (e.g. two quick status changes), an older one resolving after a
  // newer one must not overwrite the newer, already-current data.
  const loadSeq = useRef(0);

  const load = async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError('');
    try {
      const data = await api.listBugReports(statusFilter ? { status: statusFilter } : {});
      if (seq !== loadSeq.current) return; // a newer load already superseded this one
      setReports(data);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e.message);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const updateStatus = async (id, status) => {
    // Re-entrancy guard: disabled={loading} on the <select> only takes
    // effect after React's next render, so a fast double-change could
    // otherwise fire two updateBugReport calls first.
    if (loading) return;
    setLoading(true);
    try {
      await api.updateBugReport(id, status);
      await load();
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <SuperAdminLayout
      title="Bug reports"
      subtitle="Product issues from residents, guards, and building admins."
      error={error}
      loading={loading}
    >
      <div style={filterRow}>
        <label style={filterLabel}>Status</label>
        <select
          className="admin-bugs-select"
          style={select}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      {reports.length === 0 ? (
        <div style={ui.empty}>No bug reports yet.</div>
      ) : (
        reports.map((r) => (
          <div key={r.id} className="admin-card-row admin-card-row--start" style={card}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={headerRow}>
                <strong>{r.reference}</strong>
                <span style={ui.tag}>{r.status.replace('_', ' ')}</span>
              </div>
              <div style={ui.meta}>
                {r.building?.name}
                {r.flatNumber ? ` · Flat ${r.flatNumber}` : ''}
                {' · '}{r.roleKey}
                {' · '}{r.source}
                {' · '}{r.category}
                {' · '}{new Date(r.createdAt).toLocaleString('en-IN')}
              </div>
              <div style={ui.meta}>
                {r.user?.name} · {r.user?.phone}
              </div>
              <p style={message}>{r.message}</p>
              {r.imageUrl && (
                <a href={mediaUrl(r.imageUrl)} target="_blank" rel="noreferrer">
                  <img src={mediaUrl(r.imageUrl)} alt="Bug screenshot" style={thumbImg} />
                </a>
              )}
            </div>
            <select
              className="admin-bugs-select"
              value={r.status}
              onChange={(e) => updateStatus(r.id, e.target.value)}
              style={select}
              disabled={loading}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
        ))
      )}
    </SuperAdminLayout>
  );
}

const filterRow = { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 };
const filterLabel = { fontSize: 13, fontWeight: 600, color: '#374151' };
const select = {
  padding: '8px 36px 8px 12px',
  borderRadius: 8,
  border: '1px solid #E2E5E4',
  minWidth: 140,
  maxWidth: 180,
  width: '100%',
  backgroundColor: '#fff',
  color: '#23272B',
  fontSize: 14,
  lineHeight: '20px',
  cursor: 'pointer'
};
const card = { ...ui.card, marginBottom: 12 };
const headerRow = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 };
const message = { fontSize: 14, color: '#374151', marginTop: 10, marginBottom: 0, whiteSpace: 'pre-wrap' };
const thumbImg = { width: 96, height: 96, objectFit: 'cover', borderRadius: 8, marginTop: 10, border: '1px solid #E2E5E4', display: 'block' };
