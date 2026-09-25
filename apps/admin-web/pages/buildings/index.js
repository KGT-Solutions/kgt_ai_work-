import { useEffect, useState } from 'react';
import Link from 'next/link';
import SuperAdminLayout from '../../components/SuperAdminLayout';
import { api } from '../../lib/api';

function digitsOnly(phone = '') {
  return String(phone).replace(/\D/g, '').slice(-10);
}

function emptyAdminForm() {
  return { name: '', phone: '', email: '', membershipId: null };
}

function adminToForm(admin) {
  if (!admin) return emptyAdminForm();
  return {
    name: admin.name || '',
    phone: digitsOnly(admin.phone),
    email: admin.email || '',
    membershipId: admin.membershipId || null
  };
}

export default function BuildingsListPage() {
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [adminForm, setAdminForm] = useState(emptyAdminForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setBuildings(await api.listBuildings());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const toggleTile = (building) => {
    if (expandedId === building.id) {
      setExpandedId(null);
      setSaveError('');
      setSaveSuccess('');
      return;
    }
    setExpandedId(building.id);
    setAdminForm(adminToForm(building.admins?.[0]));
    setSaveError('');
    setSaveSuccess('');
  };

  const updateForm = (key, value) => {
    setAdminForm((prev) => ({ ...prev, [key]: value }));
    setSaveError('');
    setSaveSuccess('');
  };

  const saveAdmin = async (buildingId) => {
    if (!adminForm.phone.trim()) {
      setSaveError('Admin phone is required');
      return;
    }
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');
    try {
      const res = await api.updateBuildingAdmin(buildingId, {
        adminName: adminForm.name.trim(),
        adminPhone: adminForm.phone.trim(),
        adminEmail: adminForm.email.trim(),
        membershipId: adminForm.membershipId
      });
      setBuildings((prev) => prev.map((b) => (b.id === buildingId ? res.building : b)));
      setAdminForm(adminToForm(res.building.admins?.[0]));
      setSaveSuccess('Building admin updated.');
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteBuilding = async (building) => {
    const confirmed = window.confirm(
      `Delete "${building.name}" (${building.buildingCode})?\n\nThis permanently removes the building, flats, members, bills, and all related data. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(building.id);
    setSaveError('');
    setSaveSuccess('');
    try {
      await api.deleteBuilding(building.id);
      setBuildings((prev) => prev.filter((b) => b.id !== building.id));
      if (expandedId === building.id) {
        setExpandedId(null);
        setAdminForm(emptyAdminForm());
      }
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <SuperAdminLayout
      title="Buildings"
      subtitle="Select a building tile to view and update its building admin."
      error={error}
      loading={loading && buildings.length === 0}
    >
      <div style={styles.toolbar}>
        <span style={styles.count}>
          {loading ? 'Loading…' : `${buildings.length} building${buildings.length === 1 ? '' : 's'}`}
        </span>
        <Link href="/buildings/new" style={styles.primaryLink}>
          Onboard society
        </Link>
      </div>

      {!loading && !error && buildings.length === 0 && (
        <div style={styles.empty}>
          No buildings yet. Onboard your first society to get started.
        </div>
      )}

      <div className="admin-buildings-grid" style={styles.grid}>
        {buildings.map((building) => {
          const expanded = expandedId === building.id;
          const primaryAdmin = building.admins?.[0];
          return (
            <article
              key={building.id}
              style={{
                ...styles.tile,
                ...(expanded ? styles.tileExpanded : {})
              }}
            >
              <button
                type="button"
                style={styles.tileHeader}
                onClick={() => toggleTile(building)}
                aria-expanded={expanded}
              >
                <div style={styles.tileHeaderMain}>
                  <h2 style={styles.buildingName}>{building.name}</h2>
                  <p style={styles.meta}>
                    {[building.city, building.address].filter(Boolean).join(' · ') || 'No location set'}
                  </p>
                  <p style={styles.adminPreview}>
                    {primaryAdmin
                      ? `Admin · ${primaryAdmin.name || 'Unnamed'} · ${primaryAdmin.phone}`
                      : 'No building admin assigned'}
                  </p>
                </div>
                <div style={styles.tileHeaderSide}>
                  <span style={styles.codeValue}>{building.buildingCode}</span>
                  <span style={styles.expandHint}>{expanded ? 'Collapse' : 'Manage admin'}</span>
                </div>
              </button>

              {expanded && (
                <div style={styles.expandPanel}>
                  <div className="admin-grid-3" style={styles.stats}>
                    <Stat label="Plan" value={building.subscriptionTier || '—'} />
                    <Stat label="Towers" value={String(building.wingCount ?? 0)} />
                    <Stat label="Members" value={String(building.memberCount ?? 0)} />
                  </div>

                  <h3 style={styles.panelTitle}>Building admin</h3>
                  <p style={styles.panelHint}>
                    Update the admin who manages this society. Changing the phone assigns a different user as building admin.
                  </p>

                  <div className="admin-grid-2" style={styles.formGrid}>
                    <Field
                      label="Admin name"
                      value={adminForm.name}
                      onChange={(v) => updateForm('name', v)}
                      placeholder="Admin name"
                    />
                    <Field
                      label="Admin phone *"
                      value={adminForm.phone}
                      onChange={(v) => updateForm('phone', v.replace(/\D/g, '').slice(0, 10))}
                      placeholder="10-digit phone"
                      inputMode="numeric"
                    />
                    <Field
                      label="Admin email"
                      value={adminForm.email}
                      onChange={(v) => updateForm('email', v)}
                      placeholder="admin@society.in"
                    />
                  </div>

                  {saveError && <p style={styles.error}>{saveError}</p>}
                  {saveSuccess && <p style={styles.success}>{saveSuccess}</p>}

                  <div className="admin-form-actions" style={styles.actions}>
                    <button
                      type="button"
                      style={styles.saveBtn}
                      disabled={saving || deletingId === building.id || adminForm.phone.length < 10}
                      onClick={() => saveAdmin(building.id)}
                    >
                      {saving ? 'Saving…' : 'Update building admin'}
                    </button>
                    <button
                      type="button"
                      style={styles.deleteBtn}
                      disabled={saving || deletingId === building.id}
                      onClick={() => deleteBuilding(building)}
                    >
                      {deletingId === building.id ? 'Deleting…' : 'Delete building'}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </SuperAdminLayout>
  );
}

function Stat({ label, value }) {
  return (
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValue}>{value}</div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, inputMode }) {
  return (
    <div>
      <label style={styles.label}>{label}</label>
      <input
        style={styles.input}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

const styles = {
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 20
  },
  count: { fontSize: 14, color: '#6B7280' },
  primaryLink: {
    display: 'inline-flex',
    alignItems: 'center',
    background: '#2B3A4A',
    color: '#fff',
    textDecoration: 'none',
    padding: '10px 16px',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13
  },
  error: { color: '#B4483A', margin: '12px 0 0', fontSize: 14 },
  success: { color: '#6B8F71', margin: '12px 0 0', fontSize: 14, fontWeight: 500 },
  empty: {
    background: '#fff',
    border: '1px solid #E2E5E4',
    borderRadius: 12,
    padding: 32,
    textAlign: 'center',
    color: '#6B7280'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 16,
    alignItems: 'start'
  },
  tile: {
    background: '#fff',
    border: '1px solid #E2E5E4',
    borderRadius: 14,
    overflow: 'hidden',
    transition: 'box-shadow 0.15s, border-color 0.15s'
  },
  tileExpanded: {
    gridColumn: '1 / -1',
    borderColor: '#6B8F71',
    boxShadow: '0 8px 24px rgba(43, 58, 74, 0.08)'
  },
  tileHeader: {
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'flex-start',
    textAlign: 'left',
    background: 'transparent',
    border: 'none',
    padding: 18,
    cursor: 'pointer',
    fontFamily: 'inherit'
  },
  tileHeaderMain: { flex: 1, minWidth: 0 },
  tileHeaderSide: { textAlign: 'right', flexShrink: 0 },
  buildingName: { margin: 0, fontSize: 18, color: '#2B3A4A' },
  meta: { margin: '6px 0 0', fontSize: 13, color: '#6B7280' },
  adminPreview: { margin: '10px 0 0', fontSize: 13, color: '#374151', fontWeight: 500 },
  codeValue: {
    display: 'block',
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: '0.06em',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    color: '#2B3A4A'
  },
  expandHint: {
    display: 'block',
    marginTop: 8,
    fontSize: 12,
    fontWeight: 600,
    color: '#6B8F71'
  },
  expandPanel: {
    borderTop: '1px solid #E2E5E4',
    padding: '18px 20px 20px',
    background: '#FAFBFA'
  },
  stats: { gap: 12, marginBottom: 20 },
  stat: {
    background: '#fff',
    border: '1px solid #E2E5E4',
    borderRadius: 10,
    padding: '12px 14px'
  },
  statLabel: { fontSize: 11, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em' },
  statValue: { marginTop: 4, fontSize: 15, fontWeight: 600, color: '#2B3A4A', textTransform: 'capitalize' },
  panelTitle: {
    margin: '0 0 6px',
    fontSize: 15,
    fontWeight: 700,
    color: '#2B3A4A'
  },
  panelHint: { margin: '0 0 16px', fontSize: 13, color: '#6B7280' },
  formGrid: { gap: 12 },
  label: { display: 'block', fontSize: 12, color: '#6B7280', marginBottom: 6, fontWeight: 600 },
  input: {
    width: '100%',
    padding: 11,
    borderRadius: 8,
    border: '1px solid #E2E5E4',
    boxSizing: 'border-box',
    fontSize: 14,
    background: '#fff'
  },
  actions: { marginTop: 16, gap: 10 },
  saveBtn: {
    background: '#2B3A4A',
    color: '#fff',
    border: 'none',
    padding: '12px 18px',
    borderRadius: 8,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 14
  },
  deleteBtn: {
    background: '#fff',
    color: '#B4483A',
    border: '1px solid #F0C9C4',
    padding: '12px 18px',
    borderRadius: 8,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 14
  }
};
