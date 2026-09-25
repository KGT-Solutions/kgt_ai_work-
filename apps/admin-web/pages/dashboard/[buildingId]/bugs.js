import { useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';
import { ui } from '../../../components/ui';
import { api } from '../../../lib/api';

const CATEGORIES = [
  'Login',
  'Finance',
  'Residents',
  'Complaints',
  'Facilities',
  'Visitors',
  'Other'
];

export default function ReportBugPage() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!buildingId) return;
    const trimmed = message.trim();
    if (trimmed.length < 10) {
      setError('Please describe the issue in at least 10 characters.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.createBugReport(buildingId, {
        category,
        message: trimmed,
        source: 'admin-web'
      });
      setMessage('');
      setSuccess(`Bug report sent (${res.reference}). Super admin will review it.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!buildingId) return null;

  return (
    <AdminLayout buildingId={buildingId} title="Report a bug" error={error} success={success}>
      <p style={hint}>
        For FLATBRIZ admin-panel issues only (broken screens, wrong data, login problems).
        Resident society issues belong under Complaints.
      </p>
      <form onSubmit={submit} style={ui.form}>
        <label style={label}>Where?</label>
        <select style={ui.input} value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label style={label}>What went wrong?</label>
        <textarea
          style={ui.textarea}
          placeholder="Describe what happened and how to reproduce it…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
        />
        <button type="submit" style={ui.btn} disabled={loading}>
          {loading ? 'Sending…' : 'Send bug report'}
        </button>
      </form>
    </AdminLayout>
  );
}

const hint = { fontSize: 14, color: '#6b7280', lineHeight: 1.5, marginBottom: 16 };
const label = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: 6
};
