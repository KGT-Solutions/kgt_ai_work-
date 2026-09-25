import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';
import { ui, gridClass } from '../../../components/ui';
import { api } from '../../../lib/api';

const ICON_OPTIONS = [
  { value: 'clubhouse', label: 'Clubhouse' },
  { value: 'tennis', label: 'Tennis court' },
  { value: 'party', label: 'Party hall' },
  { value: 'gym', label: 'Gym' },
  { value: 'pool', label: 'Swimming pool' },
  { value: 'garden', label: 'Garden / lawn' },
  { value: 'default', label: 'Other' }
];

const TABS = [
  { key: 'facilities', label: 'Add facility' },
  { key: 'active', label: 'Active bookings' },
  { key: 'past', label: 'Past bookings' }
];

const EMPTY_FORM = { name: '', icon: 'clubhouse', description: '', capacity: '', pricePerHour: '', active: true };

function isActiveBooking(b, now = new Date()) {
  return ['pending', 'approved'].includes(b.status) && new Date(b.endTime) > now;
}

export default function FacilitiesPage() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [tab, setTab] = useState('facilities');
  const [facilities, setFacilities] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    if (!buildingId) return;
    try {
      const [facilityList, bookingList] = await Promise.all([
        api.getFacilitiesManage(buildingId),
        api.getFacilityBookings(buildingId)
      ]);
      setFacilities(facilityList);
      setBookings(bookingList);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, [buildingId]);

  const activeBookings = useMemo(
    () => bookings
      .filter((b) => isActiveBooking(b))
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime)),
    [bookings]
  );

  const pastBookings = useMemo(
    () => bookings
      .filter((b) => !isActiveBooking(b))
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime)),
    [bookings]
  );

  const pendingCount = activeBookings.filter((b) => b.status === 'pending').length;

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const saveFacility = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setLoading(true);
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        icon: form.icon,
        description: form.description.trim(),
        capacity: form.capacity === '' ? null : Number(form.capacity),
        pricePerHour: form.pricePerHour === '' ? null : Number(form.pricePerHour),
        active: form.active
      };
      if (editingId) {
        await api.updateFacility(buildingId, editingId, payload);
      } else {
        await api.createFacility(buildingId, payload);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (f) => {
    setEditingId(f.id);
    setForm({
      name: f.name,
      icon: f.icon || 'default',
      description: f.description || '',
      capacity: f.capacity ?? '',
      pricePerHour: f.pricePerHour ?? '',
      active: f.active
    });
    setTab('facilities');
  };

  const removeFacility = async (id) => {
    if (!window.confirm('Delete this facility and all its bookings?')) return;
    setError('');
    try {
      await api.deleteFacility(buildingId, id);
      if (editingId === id) resetForm();
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const decideBooking = async (bookingId, status) => {
    setError('');
    try {
      await api.updateFacilityBooking(buildingId, bookingId, status);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!buildingId) return null;

  return (
    <AdminLayout buildingId={buildingId} title="Facilities" error={error}>
      <div style={tabRow}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            style={tab === t.key ? tabActive : tabIdle}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'active' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      {tab === 'facilities' && (
        <>
          <section style={section}>
            <h2 style={ui.sectionTitle}>{editingId ? 'Edit facility' : 'Add amenity'}</h2>
            <form onSubmit={saveFacility} style={facilityForm}>
              <div className={gridClass.two} style={ui.row}>
                <input
                  style={ui.input}
                  placeholder="Facility name (e.g. Clubhouse)"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <select style={ui.input} value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })}>
                  {ICON_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <textarea
                style={ui.textarea}
                placeholder="Short description (optional)"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
              />
              <div className={gridClass.two} style={ui.row}>
                <input
                  style={ui.input}
                  type="number"
                  placeholder="Capacity"
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                />
                <input
                  style={ui.input}
                  type="number"
                  placeholder="Price per hour (₹)"
                  value={form.pricePerHour}
                  onChange={(e) => setForm({ ...form, pricePerHour: e.target.value })}
                />
              </div>
              <label style={checkbox}>
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                />
                Available for residents to book
              </label>
              <div className="admin-form-actions" style={formActions}>
                <button type="submit" style={ui.btn} disabled={loading}>
                  {loading ? 'Saving…' : editingId ? 'Update facility' : 'Add facility'}
                </button>
                {editingId && (
                  <button type="button" style={ui.btnSecondary} onClick={resetForm}>Cancel edit</button>
                )}
              </div>
            </form>
          </section>

          <section style={section}>
            <h2 style={ui.sectionTitle}>Amenities in this building</h2>
            {facilities.length === 0 ? (
              <div style={facilityEmpty}>No facilities added yet. Use the form above to add amenities residents can book.</div>
            ) : (
              <div style={grid}>
                {facilities.map((f) => (
                  <div key={f.id} style={{ ...facilityCard, ...(f.active ? {} : facilityInactive) }}>
                    <div style={facilityHeader}>
                      <strong>{f.name}</strong>
                      {!f.active && <span style={inactiveTag}>Hidden</span>}
                    </div>
                    <div style={ui.meta}>
                      {f.capacity ? `Capacity: ${f.capacity}` : 'Capacity not set'}
                      {' · '}
                      {f.pricePerHour != null ? `₹${f.pricePerHour}/hr` : 'Free'}
                    </div>
                    {f.description && <p style={desc}>{f.description}</p>}
                    <div style={ui.meta}>{f._count?.bookings ?? 0} total bookings</div>
                    <div style={facilityActions}>
                      <button type="button" style={linkBtn} onClick={() => startEdit(f)}>Edit</button>
                      <button type="button" style={deleteBtn} onClick={() => removeFacility(f.id)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'active' && (
        <section style={section}>
          <h2 style={ui.sectionTitle}>Active & upcoming bookings</h2>
          {activeBookings.length === 0 ? (
            <div style={facilityEmpty}>No active or upcoming bookings right now.</div>
          ) : (
            activeBookings.map((b) => (
              <div key={b.id} className="admin-card-row admin-card-row--start" style={cardRow}>
                <div>
                  <strong>{b.facility?.name}</strong>
                  <div style={ui.meta}>
                    {b.user?.name}{b.user?.phone ? ` · ${b.user.phone}` : ''}
                  </div>
                  <div style={ui.meta}>{formatSlot(b.startTime, b.endTime)}</div>
                  {b.facility?.pricePerHour > 0 && (
                    <div style={ui.meta}>₹{b.facility.pricePerHour}/hr</div>
                  )}
                  <span style={{ ...statusPill, ...(STATUS_STYLE[b.status] || {}), marginTop: 8, display: 'inline-block' }}>
                    {b.status}
                  </span>
                </div>
                {b.status === 'pending' ? (
                  <div className="admin-actions-col" style={actions}>
                    <button type="button" style={approveBtn} onClick={() => decideBooking(b.id, 'approved')}>
                      Approve
                    </button>
                    <button type="button" style={rejectBtn} onClick={() => decideBooking(b.id, 'rejected')}>
                      Reject
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </section>
      )}

      {tab === 'past' && (
        <section style={section}>
          <h2 style={ui.sectionTitle}>Past bookings</h2>
          {pastBookings.length === 0 ? (
            <div style={facilityEmpty}>No past bookings yet.</div>
          ) : (
            pastBookings.map((b) => (
              <div key={b.id} className="admin-history-row" style={historyRow}>
                <div>
                  <strong>{b.facility?.name}</strong>
                  <div style={ui.meta}>
                    {b.user?.name}{b.user?.phone ? ` · ${b.user.phone}` : ''} · {formatSlot(b.startTime, b.endTime)}
                  </div>
                </div>
                <span style={{ ...statusPill, ...(STATUS_STYLE[b.status] || {}) }}>{b.status}</span>
              </div>
            ))
          )}
        </section>
      )}
    </AdminLayout>
  );
}

function formatSlot(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  return `${s.toLocaleDateString('en-IN')} · ${s.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} – ${e.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

const STATUS_STYLE = {
  approved: { background: '#D1FAE5', color: '#065F46' },
  rejected: { background: '#FEE2E2', color: '#991B1B' },
  pending: { background: '#FEF3C7', color: '#92400E' },
  cancelled: { background: '#F3F4F6', color: '#6B7280' }
};

const tabRow = { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 };
const tabActive = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid #6B8F71',
  background: '#EEF4EF', color: '#2B5A3A', fontWeight: 600, cursor: 'pointer', fontSize: 13
};
const tabIdle = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E5E4',
  background: '#fff', color: '#6B7280', cursor: 'pointer', fontSize: 13
};
const section = { marginBottom: 36 };
const facilityEmpty = { ...ui.empty, padding: 24 };
const cardRow = { ...ui.card };
const actions = { gap: 8 };
const approveBtn = { padding: '8px 16px', borderRadius: 8, border: 'none', background: '#6B8F71', color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 };
const rejectBtn = { padding: '8px 16px', borderRadius: 8, border: '1px solid #E2E5E4', background: '#fff', color: '#B4483A', fontWeight: 600, cursor: 'pointer', fontSize: 13 };
const facilityForm = { ...ui.form, marginBottom: 0 };
const checkbox = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#374151' };
const formActions = { gap: 12 };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 };
const facilityCard = { ...ui.cardFlat, marginBottom: 0 };
const facilityInactive = { opacity: 0.65 };
const facilityHeader = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 };
const inactiveTag = { fontSize: 11, background: '#F3F4F6', padding: '2px 8px', borderRadius: 6, color: '#6B7280' };
const desc = { fontSize: 13, color: '#374151', margin: '8px 0' };
const facilityActions = { display: 'flex', gap: 12, marginTop: 12 };
const linkBtn = { background: 'none', border: 'none', color: '#2B3A4A', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 13 };
const deleteBtn = { background: 'none', border: 'none', color: '#B4483A', cursor: 'pointer', padding: 0, fontSize: 13 };
const historyRow = { background: '#fff', padding: '14px 20px', borderRadius: 12, marginBottom: 8, border: '1px solid #E2E5E4', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 };
const statusPill = { fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, textTransform: 'capitalize' };
