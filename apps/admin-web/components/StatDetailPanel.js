export default function StatDetailPanel({ title, onClose, children, loading }) {
  return (
    <div className="admin-modal-backdrop" style={styles.backdrop} onClick={onClose}>
      <div className="admin-modal-panel" style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>{title}</h2>
          <button type="button" style={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>
        <div style={styles.body}>
          {loading ? <p style={styles.muted}>Loading…</p> : children}
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
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #E2E5E4' },
  title: { margin: 0, fontSize: 20, color: '#2B3A4A' },
  close: { background: 'none', border: 'none', fontSize: 28, lineHeight: 1, color: '#6B7280', cursor: 'pointer', padding: 0 },
  body: { padding: '16px 24px 24px', overflowY: 'auto' },
  muted: { color: '#6B7280', margin: 0 }
};
