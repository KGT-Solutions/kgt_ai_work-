export default function FamilyApprovalCard({ member, onApprove, onReject, loading }) {
  return (
    <div className="admin-card-row admin-card-row--start" style={styles.card}>
      <div>
        <strong style={styles.name}>{member.name}</strong>
        <div style={styles.meta}>
          {member.relation} · Flat {member.flatNumber || '—'} · {member.phone}
        </div>
        <div style={styles.subMeta}>
          Requested by {member.primaryResidentName || 'resident'}
          {member.primaryResidentPhone ? ` · ${member.primaryResidentPhone}` : ''}
        </div>
        <div style={styles.note}>Login credentials will be activated on approval.</div>
      </div>
      <div className="admin-actions-row" style={styles.actions}>
        <button type="button" style={styles.approve} onClick={() => onApprove(member.id)} disabled={loading}>Approve</button>
        <button type="button" style={styles.reject} onClick={() => onReject(member.id)} disabled={loading}>Reject</button>
      </div>
    </div>
  );
}

const styles = {
  card: {
    background: '#fff', padding: 20, borderRadius: 12, marginBottom: 10,
    border: '1px solid #E2E5E4', boxShadow: '0 1px 4px rgba(0,0,0,0.04)'
  },
  name: { fontSize: 16, color: '#2B3A4A' },
  meta: { fontSize: 13, color: '#6B7280', marginTop: 4 },
  subMeta: { fontSize: 12, color: '#9CA3AF', marginTop: 4 },
  note: { fontSize: 12, color: '#6B8F71', marginTop: 8, fontWeight: 500 },
  actions: { display: 'flex', gap: 8, flexShrink: 0 },
  approve: { background: '#6B8F71', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600 },
  reject: { background: '#fff', border: '1px solid #E2E5E4', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', color: '#B4483A' }
};
