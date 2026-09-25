import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';
import { ui } from '../../../components/ui';
import { api, mediaUrl } from '../../../lib/api';

const STATUSES = ['submitted', 'in_progress', 'resolved'];

export default function ComplaintsPage() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [complaints, setComplaints] = useState([]);
  const [error, setError] = useState('');

  const load = async () => {
    if (!buildingId) return;
    try {
      setComplaints(await api.getComplaints(buildingId));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, [buildingId]);

  const updateStatus = async (id, status) => {
    try {
      await api.updateComplaint(buildingId, id, status);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!buildingId) return null;

  return (
    <AdminLayout buildingId={buildingId} title="Complaints" error={error}>
      {complaints.length === 0 ? (
        <div style={ui.empty}>No complaints yet.</div>
      ) : (
        complaints.map((c) => (
          <div key={c.id} className="admin-card-row admin-card-row--start" style={cardRow}>
            <div>
              <strong>{c.title || c.category}</strong>
              <div style={ui.meta}>
                {c.user?.name}
                {c.flatNumber && <> · Flat {c.flatNumber}</>}
                {' · '}{c.category} · {new Date(c.createdAt).toLocaleDateString('en-IN')}
              </div>
              {c.description && <p style={desc}>{c.description}</p>}
              {c.imageUrl && (
                <a href={mediaUrl(c.imageUrl)} target="_blank" rel="noreferrer">
                  <img src={mediaUrl(c.imageUrl)} alt="Complaint attachment" style={image} />
                </a>
              )}
            </div>
            <select value={c.status} onChange={(e) => updateStatus(c.id, e.target.value)} style={select}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </div>
        ))
      )}
    </AdminLayout>
  );
}

const cardRow = { ...ui.card };
const desc = { fontSize: 14, color: '#374151', marginTop: 8, marginBottom: 0 };
const image = { marginTop: 12, maxWidth: 240, maxHeight: 160, borderRadius: 8, border: '1px solid #E2E5E4', objectFit: 'cover' };
const select = { padding: '8px 12px', borderRadius: 8, border: '1px solid #E2E5E4', width: '100%', maxWidth: 220 };
