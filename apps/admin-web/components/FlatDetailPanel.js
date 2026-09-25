import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { displayTowerName } from '../lib/towers';
import { ui } from './ui';
import { showError, showSuccess, showConfirm } from './AppAlert';

const BHK_OPTIONS = [
  { value: '', label: 'Not set (default rate)' },
  { value: '1bhk', label: '1 BHK' },
  { value: '2bhk', label: '2 BHK' },
  { value: '3bhk', label: '3 BHK' }
];

function bhkLabel(value) {
  if (value === '1bhk') return '1 BHK';
  if (value === '2bhk') return '2 BHK';
  if (value === '3bhk') return '3 BHK';
  return null;
}

export default function FlatDetailPanel({ buildingId, flat, onClose, onUpdated, onDeleted }) {
  const [bhkType, setBhkType] = useState(flat?.bhkType || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setBhkType(flat?.bhkType || '');
  }, [flat?.id, flat?.bhkType]);

  if (!flat) return null;

  const saveBhk = async () => {
    if (!buildingId) return;
    setSaving(true);
    try {
      await api.updateFlat(buildingId, flat.id, {
        bhkType: bhkType || null
      });
      await showSuccess('Flat size updated. New maintenance rates apply from the next charge.', 'Saved');
      if (onUpdated) await onUpdated();
      else onClose();
    } catch (e) {
      showError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const dirty = (bhkType || '') !== (flat.bhkType || '');

  const deleteFlat = async () => {
    if (!buildingId || flat.occupied) return;
    const confirmed = await showConfirm(
      `Delete flat ${flat.number}? This cannot be undone.`,
      { title: 'Delete flat', confirmLabel: 'Delete', cancelLabel: 'Cancel' }
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      await api.deleteFlat(buildingId, flat.id);
      await showSuccess(`Deleted flat ${flat.number}`, 'Deleted');
      if (onDeleted) await onDeleted();
      else onClose();
    } catch (e) {
      showError(e.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="admin-modal-backdrop" style={styles.backdrop} onClick={onClose}>
      <div className="admin-modal-panel admin-modal-panel--narrow" style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>Flat {flat.number}</h2>
            <p style={styles.subtitle}>
              {displayTowerName(flat.wing)}
              {flat.floor != null ? ` · Floor ${flat.floor}` : ''}
              {bhkLabel(flat.bhkType) ? ` · ${bhkLabel(flat.bhkType)}` : ''}
            </p>
          </div>
          <button type="button" style={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div style={styles.body}>
          <div style={styles.editBox}>
            <h3 style={styles.sectionLabel}>Flat size</h3>
            <p style={styles.editHint}>
              Used for size-based maintenance. Leave unset to charge the default rate.
            </p>
            <select
              style={ui.input}
              value={bhkType}
              onChange={(e) => setBhkType(e.target.value)}
            >
              {BHK_OPTIONS.map((o) => (
                <option key={o.value || 'none'} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              type="button"
              style={{ ...ui.btnAccent, marginTop: 12 }}
              onClick={saveBhk}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : 'Save size'}
            </button>
          </div>

          {!flat.occupied ? (
            <div style={styles.vacantBox}>
              <span style={styles.vacantBadge}>Vacant</span>
              <p style={styles.muted}>No residents registered for this flat.</p>
              <button
                type="button"
                style={styles.deleteBtn}
                onClick={deleteFlat}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete flat'}
              </button>
            </div>
          ) : (
            flat.residents.map((resident) => (
              <div key={resident.membershipId || resident.phone} style={styles.residentBlock}>
                <h3 style={styles.sectionLabel}>Primary resident</h3>
                <div style={styles.infoRow}>
                  <span style={styles.label}>Name</span>
                  <span>{resident.name}</span>
                </div>
                <div style={styles.infoRow}>
                  <span style={styles.label}>Phone</span>
                  <span>{resident.phone}</span>
                </div>
                {resident.alsoOwns?.length > 0 && (
                  <div style={styles.alsoOwnsBox}>
                    <h3 style={{ ...styles.sectionLabel, marginBottom: 8 }}>Also owns in this society</h3>
                    <p style={styles.alsoOwnsList}>
                      {resident.alsoOwns
                        .map((f) => f.flatNumber + (f.floor != null ? ` (Fl. ${f.floor})` : ''))
                        .join(', ')}
                    </p>
                  </div>
                )}

                {resident.familyMembers?.length > 0 ? (
                  <>
                    <h3 style={{ ...styles.sectionLabel, marginTop: 20 }}>Family members</h3>
                    {resident.familyMembers.map((fm) => (
                      <div key={fm.id} style={styles.familyCard}>
                        <div style={styles.infoRow}>
                          <span style={styles.label}>Name</span>
                          <span>{fm.name}</span>
                        </div>
                        <div style={styles.infoRow}>
                          <span style={styles.label}>Relation</span>
                          <span style={styles.capitalize}>{fm.relation}</span>
                        </div>
                        {fm.phone && (
                          <div style={styles.infoRow}>
                            <span style={styles.label}>Phone</span>
                            <span>{fm.phone}</span>
                          </div>
                        )}
                        {fm.status && (
                          <div style={styles.infoRow}>
                            <span style={styles.label}>Status</span>
                            <span style={styles.capitalize}>{fm.status.replace('_', ' ')}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                ) : (
                  <p style={styles.noFamily}>No family members added yet.</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {},
  panel: {
    background: '#fff', display: 'flex', flexDirection: 'column'
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '20px 24px', borderBottom: '1px solid #E2E5E4'
  },
  title: { margin: 0, fontSize: 20, color: '#2B3A4A' },
  subtitle: { margin: '4px 0 0', fontSize: 13, color: '#6B7280' },
  close: { background: 'none', border: 'none', fontSize: 28, lineHeight: 1, color: '#6B7280', cursor: 'pointer', padding: 0 },
  body: { padding: '16px 24px 24px', overflowY: 'auto' },
  editBox: {
    marginBottom: 20, padding: '14px 14px 16px', background: '#F5F7F7', borderRadius: 10
  },
  editHint: { margin: '0 0 10px', fontSize: 13, color: '#6B7280' },
  vacantBox: { textAlign: 'center', padding: '24px 0' },
  vacantBadge: {
    display: 'inline-block', background: '#FEF3F2', color: '#B4483A',
    padding: '4px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600, marginBottom: 12
  },
  muted: { color: '#6B7280', margin: 0 },
  deleteBtn: {
    marginTop: 16,
    padding: '10px 18px',
    borderRadius: 8,
    border: '1px solid #E2B4B0',
    background: '#FEF3F2',
    color: '#B4483A',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
    fontFamily: 'inherit'
  },
  residentBlock: { marginBottom: 8 },
  sectionLabel: { fontSize: 13, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '0 0 12px' },
  infoRow: { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '8px 0', borderBottom: '1px solid #F0F0F0', fontSize: 14 },
  label: { color: '#6B7280' },
  capitalize: { textTransform: 'capitalize' },
  familyCard: { background: '#F5F7F7', borderRadius: 10, padding: '12px 14px', marginBottom: 10 },
  noFamily: { fontSize: 13, color: '#9CA3AF', marginTop: 12, fontStyle: 'italic' },
  alsoOwnsBox: {
    marginTop: 14, padding: '12px 14px', background: '#E8F0FA', borderRadius: 10
  },
  alsoOwnsList: { margin: 0, fontSize: 14, color: '#2B3A4A', fontWeight: 500 }
};
