import { useState } from 'react';
import SuperAdminLayout from '../../components/SuperAdminLayout';
import { api } from '../../lib/api';

const FEATURE_GROUPS = {
  Billing: ['maintenance_bills', 'dues_reminders', 'online_payments', 'expense_tracking'],
  Security: ['visitor_management', 'gate_pass', 'security_alerts', 'cctv_integrations'],
  Community: ['announcements', 'complaints', 'facilities_booking', 'community_directory'],
  'Add-ons': ['polls_votes', 'documents', 'parking_management', 'ev_charging', 'marketplace']
};

const ALL_FEATURES = Object.values(FEATURE_GROUPS).flat();

const DEFAULT_BUILDING = {
  name: 'Gd Apartments',
  address: 'Street 8, Sector 104',
  city: 'Noida',
  state: 'Uttar Pradesh',
  pincode: '201304',
  subscriptionTier: 'premium',
  numberOfWings: '1',
  adminName: 'Sanyam',
  adminPhone: '7417466060',
  adminEmail: 'sanyam@gdapartments.in'
};

export default function NewBuilding() {
  const [form, setForm] = useState({ ...DEFAULT_BUILDING });
  const [enabled, setEnabled] = useState(new Set(ALL_FEATURES));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const set = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const toggle = (key) => {
    const copy = new Set(enabled);
    copy.has(key) ? copy.delete(key) : copy.add(key);
    setEnabled(copy);
  };

  const submit = async () => {
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const res = await api.createBuilding({
        name: form.name.trim(),
        address: [form.address.trim(), form.city.trim(), form.state.trim(), form.pincode.trim()].filter(Boolean).join(', '),
        city: form.city.trim(),
        subscriptionTier: form.subscriptionTier,
        numberOfWings: Number(form.numberOfWings) || 0,
        adminName: form.adminName.trim(),
        adminPhone: form.adminPhone.replace(/\D/g, ''),
        enabledFeatureKeys: Array.from(enabled)
      });
      const phone = `+91${form.adminPhone.replace(/\D/g, '')}`;
      setMessage(
        `Created "${res.building.name}" · Building code: ${res.building.buildingCode} · Admin: ${form.adminName} (${phone}). Flats are not pre-created — add ranges from the Flats page after login.`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fillDefault = () => {
    setForm({ ...DEFAULT_BUILDING });
    setEnabled(new Set(ALL_FEATURES));
    setMessage('');
    setError('');
  };

  return (
    <SuperAdminLayout
      title="Onboard a new society"
      subtitle="Society details and building admin. Flat ranges are configured later by the building admin."
      error={error}
      success={message}
    >
      <div style={styles.summary}>
        <p style={styles.summaryTitle}>Setup preview</p>
        <div className="admin-grid-3" style={styles.summaryGrid}>
          <SummaryItem label="Society" value={form.name || '—'} />
          <SummaryItem label="Location" value={`${form.address}, ${form.city}`} />
          <SummaryItem
            label="Towers"
            value={
              Number(form.numberOfWings) > 0
                ? `${form.numberOfWings} empty tower shell(s) — flats added on Flats page`
                : 'None yet — add towers & flats after onboarding'
            }
          />
          <SummaryItem label="Admin" value={`${form.adminName} · +91${form.adminPhone.replace(/\D/g, '')}`} />
          <SummaryItem label="Modules" value={`${enabled.size} of ${ALL_FEATURES.length} enabled`} />
          <SummaryItem label="Plan" value={form.subscriptionTier} />
        </div>
      </div>

      <h3 style={styles.sectionTitle}>Society details</h3>
      <div className="admin-grid-2" style={styles.grid}>
        <Field label="Society name *" value={form.name} onChange={(v) => set('name', v)} placeholder="Gd Apartments" />
        <Field label="Subscription tier" value={form.subscriptionTier} onChange={(v) => set('subscriptionTier', v)} placeholder="premium" />
        <Field label="Street / Address *" value={form.address} onChange={(v) => set('address', v)} placeholder="Street 8, Sector 104" />
        <Field label="City *" value={form.city} onChange={(v) => set('city', v)} placeholder="Noida" />
        <Field label="State" value={form.state} onChange={(v) => set('state', v)} placeholder="Uttar Pradesh" />
        <Field label="Pincode" value={form.pincode} onChange={(v) => set('pincode', v)} placeholder="201304" />
        <Field
          label="Empty tower shells (optional)"
          value={form.numberOfWings}
          onChange={(v) => set('numberOfWings', v)}
          placeholder="1"
          inputMode="numeric"
        />
      </div>
      <p style={{ color: '#6B7280', fontSize: 13, marginTop: 8 }}>
        Leave towers at 0–1 if unsure. Do not pre-create flats — the building admin adds exact ranges (e.g. Tower-01 · A-101 to A-110) from the Flats page.
      </p>

      <h3 style={styles.sectionTitle}>Building admin</h3>
      <div className="admin-grid-2" style={styles.grid}>
        <Field label="Admin name *" value={form.adminName} onChange={(v) => set('adminName', v)} placeholder="Sanyam" />
        <Field label="Admin phone *" value={form.adminPhone} onChange={(v) => set('adminPhone', v)} placeholder="7417466060" inputMode="numeric" />
        <Field label="Admin email" value={form.adminEmail} onChange={(v) => set('adminEmail', v)} placeholder="admin@society.in" />
      </div>

      <div style={styles.moduleHeader}>
        <h3 style={{ ...styles.sectionTitle, margin: 0 }}>Enable modules</h3>
        <button type="button" style={styles.linkBtn} onClick={() => setEnabled(new Set(ALL_FEATURES))}>Select all</button>
      </div>
      <div className="admin-grid-4" style={styles.featureGrid}>
        {Object.entries(FEATURE_GROUPS).map(([group, keys]) => (
          <div key={group}>
            <p style={styles.groupLabel}>{group}</p>
            {keys.map((key) => (
              <label key={key} style={styles.toggleRow}>
                <span>{key.replace(/_/g, ' ')}</span>
                <input type="checkbox" checked={enabled.has(key)} onChange={() => toggle(key)} />
              </label>
            ))}
          </div>
        ))}
      </div>

      <div className="admin-onboard-actions" style={styles.actions}>
        <button type="button" style={styles.secondaryBtn} onClick={fillDefault}>Reset to Gd Apartments</button>
        <button style={styles.submit} onClick={submit} disabled={loading}>
          {loading ? 'Creating…' : 'Create building & invite admin'}
        </button>
      </div>
    </SuperAdminLayout>
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

function SummaryItem({ label, value }) {
  return (
    <div>
      <p style={styles.summaryLabel}>{label}</p>
      <p style={styles.summaryValue}>{value}</p>
    </div>
  );
}

const styles = {
  summary: { background: '#fff', borderRadius: 12, padding: 20, marginBottom: 28, border: '1px solid #E2E5E4' },
  summaryTitle: { margin: '0 0 12px', fontWeight: 600, color: '#2B3A4A', fontSize: 14 },
  summaryGrid: { gap: 16 },
  summaryLabel: { margin: 0, fontSize: 11, color: '#9CA9B3', textTransform: 'uppercase', letterSpacing: '0.04em' },
  summaryValue: { margin: '4px 0 0', fontSize: 14, color: '#2B3A4A', fontWeight: 500 },
  sectionTitle: { marginTop: 8, marginBottom: 12, color: '#2B3A4A', fontSize: 16 },
  grid: { gap: 16 },
  label: { display: 'block', fontSize: 13, color: '#6B7280', marginBottom: 4 },
  input: { width: '100%', padding: 10, borderRadius: 8, border: '1px solid #E2E5E4', boxSizing: 'border-box', fontSize: 14 },
  moduleHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 28, flexWrap: 'wrap', gap: 8 },
  linkBtn: { background: 'none', border: 'none', color: '#6B8F71', cursor: 'pointer', fontSize: 13, fontWeight: 500 },
  featureGrid: { gap: 24, marginTop: 12 },
  groupLabel: { fontWeight: 600, marginBottom: 8, color: '#2B3A4A' },
  toggleRow: { display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14, gap: 12 },
  actions: { marginTop: 32 },
  secondaryBtn: { background: '#fff', color: '#2B3A4A', border: '1px solid #E2E5E4', padding: '12px 20px', borderRadius: 8, cursor: 'pointer', fontWeight: 500 },
  submit: { background: '#2B3A4A', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: 8, fontWeight: 600, cursor: 'pointer' },
  error: { marginTop: 16, color: '#B4483A' },
  success: { marginTop: 16, color: '#6B8F71', lineHeight: 1.5 }
};
