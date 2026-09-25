export default function ApprovalCard({ approval, onApprove, onReject, loading }) {
  const isGuard = approval.role?.key === 'guard';
  const roleLabel = isGuard ? 'Security guard' : 'Resident';
  const detail = isGuard
    ? approval.user?.phone
    : `Flat ${approval.flat?.number || '—'} · ${approval.user?.phone}`;

  return (
    <div className="admin-card-row" style={styles.card}>
      <div>
        <div style={styles.topRow}>
          <strong style={styles.name}>{approval.user?.name || 'Unknown'}</strong>
          <span style={styles.badge}>{roleLabel}</span>
        </div>
        <div style={styles.meta}>{detail}</div>
      </div>
      <div className="admin-actions-row" style={styles.actions}>
        <button type="button" style={styles.approve} onClick={() => onApprove(approval.id)} disabled={loading}>Approve</button>
        <button type="button" style={styles.reject} onClick={() => onReject(approval.id)} disabled={loading}>Reject</button>
      </div>
    </div>
  );
}

const styles = {
  card: {
    background: '#fff', padding: 20, borderRadius: 12, marginBottom: 10,
    border: '1px solid #E2E5E4', boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
  },
  topRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontSize: 16, color: '#2B3A4A' },
  badge: {
    fontSize: 11, fontWeight: 600, color: '#3D6B8C', background: '#E8F0FA',
    padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.04em'
  },
  meta: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  actions: { display: 'flex', gap: 8 },
  approve: { background: '#6B8F71', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
  reject: { background: '#fff', border: '1px solid #E2E5E4', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', color: '#B4483A' }
};
