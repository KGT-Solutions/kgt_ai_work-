import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import OperatorLayout from '../../../components/OperatorLayout';
import TenantWorkspace from '../../../components/TenantWorkspace';
import { ui, colors } from '../../../components/ui';
import { api, staffWorkspace } from '../../../lib/api';

// KGT staff inspecting one company: its profile, contact and status, then the
// same workspace the company sees on its own dashboard.
export default function AdminTenantPage() {
  const router = useRouter();
  const { tenantId } = router.query;
  const [tenant, setTenant] = useState(null);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setErrorState] = useState(null);
  const [success, setSuccessState] = useState(null);
  const notify = ({ error: e, success: s }) => {
    if (e) setErrorState({ message: e, at: Date.now() });
    if (s) setSuccessState({ message: s, at: Date.now() });
  };
  const ws = useMemo(() => (tenantId ? staffWorkspace(tenantId) : null), [tenantId]);

  const load = async () => {
    if (!tenantId) return;
    try {
      setTenant(await api.getTenant(tenantId));
    } catch (e) {
      notify({ error: e.message });
    }
  };

  // The route param arrives after hydration, so wait for both it and the session.
  useEffect(() => { if (signedIn && tenantId) load(); }, [signedIn, tenantId]);

  const toggleActive = async () => {
    try {
      await api.updateTenant(tenant.id, { active: !tenant.active });
      notify({ success: tenant.active ? 'Deactivated — dashboard, API keys and widget stop working immediately.' : 'Reactivated.' });
      await load();
    } catch (e) {
      notify({ error: e.message });
    }
  };

  const m = tenant?.metrics;

  return (
    <OperatorLayout
      title={tenant?.name || 'Company'}
      subtitle={tenant ? `${tenant.industryLabel} · ${tenant.slug}` : ''}
      error={error}
      success={success}
      onSession={() => setSignedIn(true)}
      loading={!tenant}
    >
      {tenant && ws && (
        <>
          <div style={{ ...ui.form, gap: 10, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ ...ui.tag, ...(tenant.active ? ui.tagOpen : ui.tagClosed) }}>{tenant.active ? 'Active' : 'Deactivated'}</span>
              <span style={ui.hint}>Support confidence gate: {Math.round(tenant.minConfidence * 100)}%</span>
              <button type="button" style={{ ...ui.btnSecondary, marginLeft: 'auto', padding: '6px 14px' }} onClick={toggleActive}>
                {tenant.active ? 'Deactivate company' : 'Reactivate company'}
              </button>
            </div>
            <dl style={facts}>
              <dt style={dt}>Contact</dt>
              <dd style={dd}>
                {m.accounts.length
                  ? m.accounts.map((a) => `${a.name ? `${a.name} · ` : ''}${a.email}`).join(', ')
                  : tenant.signupEmail || 'Staff-created (no dashboard login)'}
              </dd>
              <dt style={dt}>Joined</dt>
              <dd style={dd}>{new Date(tenant.createdAt).toLocaleString('en-IN')}</dd>
              <dt style={dt}>Knowledge</dt>
              <dd style={dd}>{m.documents} documents</dd>
              <dt style={dt}>API keys</dt>
              <dd style={dd}>{m.activeKeys} active{m.keyLastUsedAt ? `, last used ${new Date(m.keyLastUsedAt).toLocaleString('en-IN')}` : ', not used yet'}</dd>
              <dt style={dt}>Usage</dt>
              <dd style={dd}>{m.conversations} conversations, {m.questions} questions, {m.llmCalls} AI answers (≈ ${m.estimatedCostUsd.toFixed(4)})</dd>
            </dl>
          </div>

          <TenantWorkspace ws={ws} tenant={tenant} audience="staff" notify={notify} />
        </>
      )}
    </OperatorLayout>
  );
}

const facts = { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', margin: 0, fontSize: 14 };
const dt = { color: colors.textMuted, fontWeight: 600 };
const dd = { margin: 0, color: colors.text };
