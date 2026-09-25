import Link from 'next/link';
import { useEffect, useState } from 'react';
import SuperAdminLayout from '../../components/SuperAdminLayout';
import { ui, colors, radius } from '../../components/ui';
import { api } from '../../lib/api';

export default function TenantsPage() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        setTenants(await api.listTenants());
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <SuperAdminLayout
      title="Tenants"
      subtitle="Customers running the chat engine on their own data — any industry, same pipeline."
      error={error}
      loading={loading}
    >
      <div style={{ marginBottom: 20 }}>
        <Link href="/tenants/new" style={ui.btn}>+ New tenant</Link>
      </div>

      {tenants.length === 0 ? (
        <div style={ui.empty}>No tenants yet. Create the first one to try the engine on a different industry.</div>
      ) : (
        <div className="admin-table-scroll" style={tableWrap}>
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Industry</th>
                <th style={th}>Min. confidence</th>
                <th style={th}>Status</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="admin-table-row-clickable" onClick={() => window.location.assign(`/tenants/${t.id}`)}>
                  <td style={td}>
                    <strong>{t.name}</strong>
                    <div style={{ fontSize: 12, color: colors.textMuted }}>{t.slug}</div>
                  </td>
                  <td style={td}>{t.industryLabel}</td>
                  <td style={td}>{Math.round(t.minConfidence * 100)}%</td>
                  <td style={td}>
                    <span style={t.active ? ui.tagOpen : ui.tagClosed}>{t.active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>{new Date(t.createdAt).toLocaleDateString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SuperAdminLayout>
  );
}

const tableWrap = { borderRadius: radius.lg };
const table = { width: '100%', background: colors.card, borderCollapse: 'collapse' };
const th = {
  textAlign: 'left', padding: '12px 16px', fontSize: 12, color: colors.textMuted,
  borderBottom: `1px solid ${colors.border}`, background: '#FAFAFA', whiteSpace: 'nowrap'
};
const td = { padding: '12px 16px', fontSize: 14, color: colors.text, borderBottom: `1px solid ${colors.border}`, verticalAlign: 'top' };
