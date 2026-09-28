import { useMemo, useState } from 'react';
import AppLayout from '../components/AppLayout';
import TenantWorkspace from '../components/TenantWorkspace';
import { ui } from '../components/ui';
import { clientWorkspace } from '../lib/api';
import { takeSignupHandoff } from '../lib/signupHandoff';

// A client company's own dashboard: only its own tenant, resolved by the API
// from the signed-in account — there is no tenant id anywhere on this page.
export default function Dashboard() {
  const [tenant, setTenant] = useState(null);
  const [welcome, setWelcome] = useState(null);
  const [error, setErrorState] = useState(null);
  const [success, setSuccessState] = useState(null);
  const notify = ({ error: e, success: s }) => {
    if (e) setErrorState({ message: e, at: Date.now() });
    if (s) setSuccessState({ message: s, at: Date.now() });
  };
  const ws = useMemo(() => clientWorkspace(), []);

  return (
    <AppLayout
      audience="client"
      title={tenant ? tenant.name : 'Dashboard'}
      subtitle={tenant ? 'Your Support and Sales bots — knowledge, testing, keys and usage.' : ''}
      error={error}
      success={success}
      onSession={(s) => {
        const handoff = takeSignupHandoff();
        if (handoff && handoff.slug === s.tenant.slug) setWelcome(handoff);
        setTenant(s.tenant);
      }}
    >
      {tenant && (
        <>
          {welcome && (
            <div style={{ ...ui.form, background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
              <p style={ui.formTitle}>Your bots are live 🎉</p>
              <p style={ui.hint}>
                Trained on {welcome.documentsCreated} document{welcome.documentsCreated === 1 ? '' : 's'}. Copy your API key and
                embed snippet below now, then try both bots in <strong>Test bots</strong>.
              </p>
            </div>
          )}
          <TenantWorkspace ws={ws} tenant={tenant} audience="client" notify={notify} freshKey={welcome?.apiKey} />
        </>
      )}
    </AppLayout>
  );
}
