import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';
import { ui } from '../../../components/ui';
import { api } from '../../../lib/api';

export default function AnnouncementsPage() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!buildingId) return;
    try {
      setItems(await api.getAnnouncements(buildingId));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, [buildingId]);

  const publish = async (e) => {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.createAnnouncement(buildingId, { title: title.trim(), body: body.trim(), category });
      setTitle('');
      setBody('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!buildingId) return null;

  return (
    <AdminLayout buildingId={buildingId} title="Announcements" error={error}>
      <form onSubmit={publish} style={ui.form}>
        <h3 style={ui.formTitle}>Post new announcement</h3>
        <input style={ui.input} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea style={ui.textarea} placeholder="Message for all residents" value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
        <select style={ui.input} value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="general">General</option>
          <option value="maintenance">Maintenance</option>
          <option value="event">Event</option>
          <option value="urgent">Urgent</option>
        </select>
        <button type="submit" style={submitBtn} disabled={loading}>{loading ? 'Publishing…' : 'Publish announcement'}</button>
      </form>

      <h3 style={listTitle}>Recent announcements</h3>
      {items.length === 0 ? (
        <div style={ui.empty}>No announcements posted yet.</div>
      ) : (
        items.map((a) => (
          <div key={a.id} style={ui.card}>
            <div className="admin-card-header">
              <strong>{a.title}</strong>
              <span style={ui.tag}>{a.category}</span>
            </div>
            <p style={bodyText}>{a.body}</p>
            <div style={ui.meta}>{new Date(a.postedAt).toLocaleString('en-IN')}</div>
          </div>
        ))
      )}
    </AdminLayout>
  );
}

const submitBtn = { ...ui.btn, alignSelf: 'flex-start' };
const listTitle = { ...ui.sectionTitle, marginTop: 32 };
const bodyText = { margin: '8px 0', color: '#374151', lineHeight: 1.5 };
