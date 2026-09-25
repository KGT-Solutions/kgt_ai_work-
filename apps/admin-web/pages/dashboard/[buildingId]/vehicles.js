import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '../../../components/AdminLayout';
import { ui } from '../../../components/ui';
import { api } from '../../../lib/api';
import { colors, radius } from '../../../lib/theme';

const STATUS_OPTIONS = [
  { key: 'submitted', label: 'Req submitted' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'done', label: 'Done' }
];

const CATEGORY_LABELS = {
  car: 'Car',
  bike: 'Bike',
  scooter: 'Scooter',
  ev: 'Electric vehicle',
  commercial: 'Commercial',
  other: 'Other'
};

function statusStyle(status) {
  if (status === 'done') return { bg: '#E8F0E9', color: '#4A7C59' };
  if (status === 'in_progress') return { bg: '#FFFBF5', color: '#D98E3B' };
  return { bg: '#FEF3F2', color: '#B4483A' };
}

export default function VehiclesPage() {
  const router = useRouter();
  const { buildingId } = router.query;
  const [vehicles, setVehicles] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [loadingId, setLoadingId] = useState(null);
  const [error, setError] = useState('');

  const load = async () => {
    if (!buildingId) return;
    try {
      const params = {};
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterCategory !== 'all') params.category = filterCategory;
      setVehicles(await api.getVehiclesManage(buildingId, params));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => { load(); }, [buildingId, filterStatus, filterCategory]);

  const updateStatus = async (vehicleId, status) => {
    setLoadingId(vehicleId);
    setError('');
    try {
      await api.updateVehicleStatus(buildingId, vehicleId, status);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingId(null);
    }
  };

  const byCategory = useMemo(() => {
    return vehicles.reduce((acc, v) => {
      const key = v.categoryLabel || v.category;
      if (!acc[key]) acc[key] = [];
      acc[key].push(v);
      return acc;
    }, {});
  }, [vehicles]);

  const pendingCount = vehicles.filter((v) => v.gatePassStatus !== 'done').length;

  if (!buildingId) return null;

  return (
    <AdminLayout buildingId={buildingId} title="Vehicles" error={error}>
      <p style={intro}>
        View registered vehicles by category and flat. Update gate pass requests through Req submitted → In progress → Done.
      </p>

      <div className="admin-stats-row" style={statsRow}>
        <div style={statCard}>
          <div style={statValue}>{vehicles.length}</div>
          <div style={statLabel}>Total vehicles</div>
        </div>
        <div style={statCard}>
          <div style={{ ...statValue, color: colors.warning }}>{pendingCount}</div>
          <div style={statLabel}>Pending gate passes</div>
        </div>
      </div>

      <div className="admin-filter-row" style={filters}>
        <select style={filterSelect} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <select style={filterSelect} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="all">All categories</option>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {vehicles.length === 0 ? (
        <div style={ui.empty}>No vehicle registrations yet.</div>
      ) : (
        Object.keys(byCategory).sort().map((category) => (
          <section key={category} style={section}>
            <h3 style={sectionTitle}>{category} ({byCategory[category].length})</h3>
            <div className="admin-table-scroll" style={tableWrap}>
              <table style={table}>
                <thead>
                  <tr>
                    <th style={th}>Flat</th>
                    <th style={th}>Resident</th>
                    <th style={th}>Vehicle</th>
                    <th style={th}>Reg. number</th>
                    <th style={th}>Gate pass</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {byCategory[category].map((v) => {
                    const st = statusStyle(v.gatePassStatus);
                    return (
                      <tr key={v.id}>
                        <td style={td}>{v.flatNumber || '—'}</td>
                        <td style={td}>{v.residentName || '—'}</td>
                        <td style={td}>
                          {v.makeModel}
                          {v.color ? <span style={subMeta}> · {v.color}</span> : null}
                        </td>
                        <td style={{ ...td, fontWeight: 700 }}>{v.registrationNumber}</td>
                        <td style={td}>
                          <span style={{ ...statusBadge, background: st.bg, color: st.color }}>
                            {v.gatePassStatusLabel}
                          </span>
                        </td>
                        <td style={td}>
                          <div style={actions}>
                            {STATUS_OPTIONS.map((s) => (
                              <button
                                key={s.key}
                                type="button"
                                disabled={loadingId === v.id || v.gatePassStatus === s.key}
                                style={{
                                  ...actionBtn,
                                  ...(v.gatePassStatus === s.key ? actionBtnActive : {})
                                }}
                                onClick={() => updateStatus(v.id, s.key)}
                              >
                                {s.label}
                              </button>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </AdminLayout>
  );
}

const intro = { ...ui.meta, marginTop: -12, marginBottom: 20, fontSize: 14 };
const statsRow = { marginBottom: 20 };
const statCard = {
  background: colors.card, border: `1px solid ${colors.border}`, borderRadius: radius.lg,
  padding: '16px 20px'
};
const statValue = { fontSize: 28, fontWeight: 700, color: colors.primary };
const statLabel = { fontSize: 12, color: colors.textMuted, marginTop: 4 };
const filters = { marginBottom: 20 };
const filterSelect = {
  padding: '10px 12px', borderRadius: radius.sm, border: `1px solid ${colors.border}`,
  fontSize: 14, background: colors.card
};
const section = { marginBottom: 32 };
const sectionTitle = { ...ui.sectionTitle, fontSize: 16, marginBottom: 12 };
const tableWrap = { borderRadius: radius.lg, border: `1px solid ${colors.border}` };
const table = { width: '100%', background: colors.card, borderCollapse: 'collapse' };
const th = {
  textAlign: 'left', padding: '12px 16px', fontSize: 12, color: colors.textMuted,
  borderBottom: `1px solid ${colors.border}`, background: '#FAFAFA', whiteSpace: 'nowrap'
};
const td = { padding: '12px 16px', fontSize: 14, color: colors.primary, borderBottom: `1px solid ${colors.border}`, verticalAlign: 'top' };
const subMeta = { color: colors.textMuted, fontWeight: 400 };
const statusBadge = { padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' };
const actions = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 120 };
const actionBtn = {
  padding: '6px 10px', borderRadius: 6, border: `1px solid ${colors.border}`,
  background: colors.card, fontSize: 11, fontWeight: 600, cursor: 'pointer', textAlign: 'left'
};
const actionBtnActive = { background: colors.primary, color: '#fff', borderColor: colors.primary, cursor: 'default' };
