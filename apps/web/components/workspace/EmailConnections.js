import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, Checkbox, Spinner } from '../ui';
import { useToast } from '../ui/toast';

// Email Connection (Feature 10): connect a Google or Microsoft account for
// send-only delivery (tokens live encrypted on the server, never here), and
// choose which email types the bot may send. Custom SMTP is configured
// separately below (SmtpSettings) and still works; whichever is set up is used,
// with an OAuth connection taking precedence.

const PROVIDERS = [
  { id: 'google', label: 'Google', mark: 'G', color: '#4285F4', note: 'Gmail / Google Workspace' },
  { id: 'microsoft', label: 'Microsoft', mark: 'M', color: '#0078D4', note: 'Outlook / Microsoft 365' }
];

// The per-email-type toggles, in display order.
const TOGGLES = [
  { key: 'leadAlerts', label: 'New lead alerts', desc: 'Email your team when a visitor leaves their email address.' },
  { key: 'attentionAlerts', label: 'Needs-attention alerts', desc: 'Email your team on a handoff or a low-confidence answer.' },
  { key: 'visitorConfirmation', label: 'Visitor confirmation', desc: 'Email the visitor a confirmation after they share their email.' }
];

function formatWhen(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

export default function EmailConnections({ ws }) {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [savingToggle, setSavingToggle] = useState(null);

  const load = useCallback(async () => {
    try {
      setStatus(await ws.getEmailConnection());
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [ws, toast]);

  useEffect(() => { load(); }, [load]);

  // The OAuth callback redirects back here with ?email=connected|error.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get('email');
    if (!result) return;
    if (result === 'connected') toast.success('Email account connected. Your bot now sends through it.');
    else toast.error(`Couldn’t connect that account${params.get('reason') ? ` (${params.get('reason')})` : ''}. Please try again.`);
    params.delete('email');
    params.delete('reason');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [toast]);

  const connect = async (provider) => {
    setBusyProvider(provider);
    try {
      const { authUrl } = await ws.connectEmail(provider);
      if (authUrl) window.location.href = authUrl; // full-page redirect to the provider's consent screen
      else { toast.error('Could not start the connection.'); setBusyProvider(null); }
    } catch (e) {
      toast.error(e.message);
      setBusyProvider(null);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      setStatus(await ws.disconnectEmail());
      toast.success('Email account disconnected. The platform default (or your SMTP) will be used.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDisconnecting(false);
    }
  };

  const toggle = async (key, value) => {
    setSavingToggle(key);
    // Optimistic: reflect immediately, roll back on error.
    setStatus((s) => ({ ...s, toggles: { ...s.toggles, [key]: value } }));
    try {
      setStatus(await ws.saveEmailToggles({ [key]: value }));
    } catch (e) {
      toast.error(e.message);
      setStatus((s) => ({ ...s, toggles: { ...s.toggles, [key]: !value } }));
    } finally {
      setSavingToggle(null);
    }
  };

  if (loading || !status) {
    return <Card className="flex items-center gap-2 p-6 text-sm text-fg-3"><Spinner className="h-4 w-4" />Loading email connection…</Card>;
  }

  const anyConfigured = status.anyConfigured;
  const connectedProvider = status.connected ? PROVIDERS.find((p) => p.id === status.provider) : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Connect an email account"
          description="Send through your own Google or Microsoft account with a secure, send-only connection. Nothing can read your mail, and your sign-in is never stored in the browser."
          action={status.connected ? <Badge tone="success" dot>Connected</Badge> : null} />
        <div className="p-5">
          {status.connected ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                  style={{ backgroundColor: connectedProvider?.color || '#64748b' }}>{connectedProvider?.mark || '@'}</span>
                <div>
                  <p className="text-sm font-semibold text-fg">{connectedProvider?.label || status.provider} · {status.email || 'connected'}</p>
                  <p className="text-[12px] text-fg-3">
                    Sending as this account{status.connectedAt ? ` · connected ${formatWhen(status.connectedAt)}` : ''}{status.connectedBy ? ` by ${status.connectedBy}` : ''}.
                  </p>
                </div>
              </div>
              <Button variant="danger" onClick={disconnect} loading={disconnecting} disabled={disconnecting}>Disconnect</Button>
            </div>
          ) : !anyConfigured ? (
            <p className="text-[13px] leading-relaxed text-fg-3">
              Google and Microsoft sign-in aren’t set up on this server yet. You can still send from your own mailbox using
              <span className="font-medium text-fg-2"> custom SMTP</span> below, or your administrator can enable OAuth sign-in.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              {PROVIDERS.map((p) => {
                const configured = status.providers?.[p.id]?.configured;
                return (
                  <button key={p.id} type="button" onClick={() => connect(p.id)} disabled={!configured || busyProvider}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${configured ? 'border-white/10 bg-white/[0.02] hover:border-white/25' : 'cursor-not-allowed border-white/[0.06] opacity-50'}`}>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: p.color }}>{p.mark}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-fg">{busyProvider === p.id ? 'Connecting…' : `Connect ${p.label}`}</span>
                      <span className="block text-[11.5px] text-fg-3">{configured ? p.note : 'Not enabled on this server'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Which emails to send"
          description="Turn individual email types on or off. Account-security emails (password resets, sign-in codes) are always sent and aren’t listed here." />
        <div className="divide-y divide-white/[0.06] p-5 pt-1">
          {TOGGLES.map((t) => (
            <div key={t.key} className="flex items-start justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-fg">{t.label}</p>
                <p className="text-[12.5px] leading-relaxed text-fg-3">{t.desc}</p>
              </div>
              <Checkbox checked={status.toggles?.[t.key] !== false} disabled={savingToggle === t.key}
                onChange={(e) => toggle(t.key, e.target.checked)}>
                <span className="text-[12.5px] text-fg-3">{status.toggles?.[t.key] !== false ? 'On' : 'Off'}</span>
              </Checkbox>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
