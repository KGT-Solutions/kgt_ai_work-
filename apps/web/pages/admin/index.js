import Link from 'next/link';
import { useState } from 'react';
import OperatorLayout from '../../components/OperatorLayout';
import { ui, colors, radius, gridClass } from '../../components/ui';
import { api } from '../../lib/api';

// KGT staff master control: every registered company with its contact,
// knowledge, keys and usage, and activate / deactivate.
export default function AdminOverview() {
  const [tenants, setTenants] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all | active | inactive
  const [busyId, setBusyId] = useState(null);
  const [error, setErrorState] = useState(null);
  const [success, setSuccessState] = useState(null);
  const notify = ({ error: e, success: s }) => {
    if (e) setErrorState({ message: e, at: Date.now() });
    if (s) setSuccessState({ message: s, at: Date.now() });
  };

  const load = async () => {
    try {
      setTenants(await api.listTenants());
    } catch (e) {
      notify({ error: e.message });
    }
  };

  const toggle = async (t) => {
    setBusyId(t.id);
    try {
      await api.updateTenant(t.id, { active: !t.active });
      notify({ success: t.active ? `${t.name} deactivated — its dashboard, API keys and widget stop working immediately.` : `${t.name} reactivated.` });
      await load();
    } catch (e) {
      notify({ error: e.message });
    } finally {
      setBusyId(null);
    }
  };

  const q = query.trim().toLowerCase();
  const visible = (tenants || []).filter((t) =>
    (statusFilter === 'all' || (statusFilter === 'active') === t.active) &&
    (!q || [t.name, t.slug, t.industryLabel, t.signupEmail, ...t.metrics.accounts.map((a) => a.email)]
      .some((v) => String(v || '').toLowerCase().includes(q))));

  const sum = (f) => (tenants || []).reduce((acc, t) => acc + f(t), 0);
  const totals = tenants && [
    { label: 'Companies', value: tenants.length, sub: `${tenants.filter((t) => t.active).length} active` },
    { label: 'Training documents', value: sum((t) => t.metrics.documents) },
    { label: 'Conversations', value: sum((t) => t.metrics.conversations), sub: `${sum((t) => t.metrics.questions).toLocaleString('en-IN')} questions` },
    { label: 'AI answers', value: sum((t) => t.metrics.llmCalls), sub: `≈ $${sum((t) => t.metrics.estimatedCostUsd).toFixed(2)} LLM cost` }
  ];

  return (
    <OperatorLayout
      title="All companies"
      subtitle="Every client registered on KGT AI Hub. Staff only."
      error={error}
      success={success}
      onSession={load}
    >
      {!tenants ? (
        <div style={ui.empty}>Loading companies…</div>
      ) : (
        <>
          <div className={gridClass.four} style={{ ...ui.statGrid, marginBottom: 20 }}>
            {totals.map((t) => (
              <div key={t.label} style={{ ...ui.statCard, cursor: 'default' }}>
                <div style={ui.hint}>{t.label}</div>
                <div style={{ fontSize: 26, fontWeight: 700, color: colors.primary, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                  {Number(t.value).toLocaleString('en-IN')}
                </div>
                {t.sub && <div style={{ ...ui.hint, marginTop: 4 }}>{t.sub}</div>}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <input
              style={{ ...ui.input, flex: '1 1 280px' }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by company, industry or email"
              aria-label="Search companies"
            />
            <select style={{ ...ui.input, width: 'auto' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </select>
          </div>

          {visible.length === 0 ? (
            <div style={ui.empty}>{tenants.length ? 'No companies match.' : 'No companies yet — they appear here as soon as they finish signup.'}</div>
          ) : (
            <div className="admin-table-scroll" style={{ borderRadius: radius.lg }}>
              <table style={{ width: '100%', background: colors.card, borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Company</th>
                    <th style={th}>Contact</th>
                    <th style={{ ...th, textAlign: 'right' }}>Docs</th>
                    <th style={th}>API keys</th>
                    <th style={th}>Usage</th>
                    <th style={th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((t) => {
                    const m = t.metrics;
                    const contact = m.accounts[0]?.email || t.signupEmail;
                    return (
                      <tr key={t.id}>
                        <td style={td}>
                          <Link href={`/admin/tenants/${t.id}`} style={{ fontWeight: 700, color: colors.primary }}>{t.name}</Link>
                          <div style={ui.meta}>{t.industryLabel}</div>
                          <div style={ui.meta}>Joined {new Date(t.createdAt).toLocaleDateString('en-IN')} · <code>{t.slug}</code></div>
                        </td>
                        <td style={td}>
                          {contact ? <div>{contact}</div> : <span style={ui.meta}>Staff-created</span>}
                          {m.accounts[0]?.name && <div style={ui.meta}>{m.accounts[0].name}</div>}
                          <div style={ui.meta}>
                            {m.accounts.length
                              ? `Last sign-in ${m.accounts[0].lastLoginAt ? new Date(m.accounts[0].lastLoginAt).toLocaleDateString('en-IN') : 'never'}`
                              : 'No dashboard login'}
                          </div>
                        </td>
                        <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{m.documents}</td>
                        <td style={td}>
                          <div>{m.activeKeys} active</div>
                          <div style={ui.meta}>{m.keyLastUsedAt ? `Used ${new Date(m.keyLastUsedAt).toLocaleDateString('en-IN')}` : 'Not used yet'}</div>
                        </td>
                        <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>
                          <div>{m.conversations} conversations</div>
                          <div style={ui.meta}>{m.questions} questions · {m.llmCalls} AI answers</div>
                        </td>
                        <td style={td}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
                            <span style={{ ...ui.tag, ...(t.active ? ui.tagOpen : ui.tagClosed) }}>{t.active ? 'Active' : 'Deactivated'}</span>
                            <button type="button" style={linkBtn} onClick={() => toggle(t)} disabled={busyId === t.id}>
                              {busyId === t.id ? 'Saving…' : t.active ? 'Deactivate' : 'Reactivate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </OperatorLayout>
  );
}

const th = {
  textAlign: 'left', padding: '12px 16px', fontSize: 12, color: colors.textMuted,
  borderBottom: `1px solid ${colors.border}`, background: '#FAFAFA', whiteSpace: 'nowrap'
};
const td = { padding: '12px 16px', fontSize: 14, color: colors.text, borderBottom: `1px solid ${colors.border}`, verticalAlign: 'top' };
const linkBtn = { background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#3D6B8C', fontWeight: 600, fontSize: 13 };
