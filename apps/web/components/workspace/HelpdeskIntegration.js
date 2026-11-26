import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, Select, Spinner } from '../ui';
import { IconTicket } from '../ui/icons';
import { useToast } from '../ui/toast';

// Helpdesk integration (Feature 5): connect Zoho Desk or Freshdesk so an
// escalated chat opens a real ticket there. Unlike the CRM, this is
// credential-based (no OAuth redirect) — the tenant pastes an API key (Freshdesk)
// or a refresh token + org/department (Zoho Desk). Secrets go straight to the
// API, which verifies them, encrypts them and never sends them back. The browser
// only ever sees the non-secret status (domain, region, org id) and the push log.

const PROVIDER_META = {
  freshdesk: { label: 'Freshdesk', color: '#25c16f', letter: 'F' },
  zoho_desk: { label: 'Zoho Desk', color: '#E42527', letter: 'Z' }
};
const REGION_LABELS = {
  in: 'India (.in)', com: 'Global (.com)', eu: 'Europe (.eu)', au: 'Australia (.au)',
  jp: 'Japan (.jp)', ca: 'Canada (.ca)', sa: 'Saudi Arabia (.sa)'
};
const LOG_TONE = { SUCCESS: 'success', FAILED: 'danger', SKIPPED: 'warning', PENDING: 'neutral' };

function timeAgo(value) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const s = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(value).toLocaleDateString();
}

function LogRow({ log }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Badge tone={LOG_TONE[log.status] || 'neutral'}>{log.status}</Badge>
        <div className="min-w-0">
          <p className="truncate text-[13px] text-fg-2">
            Ticket create
            {log.externalTicketId && <span className="text-fg-3"> · #{log.externalTicketId}</span>}
          </p>
          {log.status !== 'SUCCESS' && log.error?.message && (
            <p className="truncate text-[11.5px] text-rose-300/90">{log.error.message}</p>
          )}
        </div>
      </div>
      <span className="shrink-0 text-[11.5px] text-fg-3">{timeAgo(log.createdAt)}</span>
    </li>
  );
}

const BLANK = { freshdeskDomain: '', apiKey: '', region: 'in', orgId: '', departmentId: '', refreshToken: '' };

export default function HelpdeskIntegration({ ws }) {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [provider, setProvider] = useState('freshdesk');
  const [form, setForm] = useState(BLANK);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(''); // 'connect' | 'disconnect' | 'toggle'

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    try {
      const s = await ws.getHelpdesk();
      setStatus(s);
      if (s.provider) setProvider(s.provider);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [ws, toast]);

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const connect = async () => {
    setBusy('connect');
    try {
      const payload = provider === 'freshdesk'
        ? { provider, freshdeskDomain: form.freshdeskDomain.trim(), apiKey: form.apiKey.trim() }
        : { provider, region: form.region, orgId: form.orgId.trim(), departmentId: form.departmentId.trim(), refreshToken: form.refreshToken.trim() };
      await ws.connectHelpdesk(payload);
      toast.success(`${PROVIDER_META[provider].label} connected.`);
      setForm(BLANK);
      await load({ silent: true });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await ws.disconnectHelpdesk();
      toast.success('Helpdesk disconnected.');
      await load({ silent: true });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  };

  const toggleEnabled = async (next) => {
    setBusy('toggle');
    try {
      await ws.setHelpdeskEnabled(next);
      await load({ silent: true });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return <Card className="flex items-center gap-2 p-6 text-sm text-fg-3"><Spinner className="h-4 w-4" />Loading helpdesk…</Card>;
  }

  const connected = !!status?.connected;
  const meta = PROVIDER_META[status?.provider] || PROVIDER_META[provider];
  const regions = status?.regions?.length ? status.regions : Object.keys(REGION_LABELS);
  const logs = status?.recentLogs || [];

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Helpdesk (Zoho Desk / Freshdesk)"
        description="When a chat is escalated to a person, open a ticket in your helpdesk automatically. Credentials are stored encrypted and never shown here."
        icon={<span className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: meta.color }}>{meta.letter}</span>}
        action={<Badge tone={connected ? 'success' : 'neutral'} dot>{connected ? 'Connected' : 'Not connected'}</Badge>}
      />

      <div className="p-5 sm:p-6">
        {connected ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
              <div className="min-w-0 text-[13px] text-fg-2">
                <span className="font-medium text-fg">{PROVIDER_META[status.provider]?.label || status.provider}</span>
                {status.freshdeskDomain && <span className="text-fg-3"> · {status.freshdeskDomain}</span>}
                {status.region && <span className="text-fg-3"> · {REGION_LABELS[status.region] || status.region}</span>}
                {status.orgId && <span className="text-fg-3"> · org {status.orgId}</span>}
              </div>
              <Checkbox checked={!!status.isEnabled} disabled={busy === 'toggle'} onChange={(e) => toggleEnabled(e.target.checked)}>
                Create tickets on escalation
              </Checkbox>
            </div>
            {!status.isEnabled && (
              <p className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-[13px] leading-relaxed text-amber-100">
                Connected, but ticket creation is paused — escalations won't open helpdesk tickets until you turn it back on.
              </p>
            )}
            <Button variant="secondary" onClick={disconnect} loading={busy === 'disconnect'} disabled={!!busy}>Disconnect</Button>
          </div>
        ) : (
          <div className="space-y-5">
            <Field label="Helpdesk provider" htmlFor="hd-provider">
              <Select id="hd-provider" value={provider} onChange={(e) => setProvider(e.target.value)} className="sm:max-w-xs">
                <option value="freshdesk">Freshdesk</option>
                <option value="zoho_desk">Zoho Desk</option>
              </Select>
            </Field>

            {provider === 'freshdesk' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Freshdesk domain" htmlFor="hd-domain" hint='e.g. "acme" or "acme.freshdesk.com"'>
                  <Input id="hd-domain" value={form.freshdeskDomain} onChange={set('freshdeskDomain')} placeholder="acme.freshdesk.com" />
                </Field>
                <Field label="API key" htmlFor="hd-key" hint="From Freshdesk → Profile settings. Stored encrypted.">
                  <Input id="hd-key" type="password" autoComplete="off" value={form.apiKey} onChange={set('apiKey')} placeholder="••••••••" />
                </Field>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Data centre (region)" htmlFor="hd-region" hint="Where your Zoho account lives.">
                  <Select id="hd-region" value={form.region} onChange={set('region')}>
                    {regions.map((r) => <option key={r} value={r}>{REGION_LABELS[r] || r}</option>)}
                  </Select>
                </Field>
                <Field label="Org ID" htmlFor="hd-org" hint="Zoho Desk → Setup → Developer Space → API.">
                  <Input id="hd-org" value={form.orgId} onChange={set('orgId')} placeholder="700xxxxxxx" />
                </Field>
                <Field label="Department ID" htmlFor="hd-dept" hint="The department new tickets land in.">
                  <Input id="hd-dept" value={form.departmentId} onChange={set('departmentId')} placeholder="18xxxxxxxxxx" />
                </Field>
                <Field label="Refresh token" htmlFor="hd-refresh" hint="A self-client OAuth refresh token with Desk ticket scope. Stored encrypted.">
                  <Input id="hd-refresh" type="password" autoComplete="off" value={form.refreshToken} onChange={set('refreshToken')} placeholder="1000.••••" />
                </Field>
              </div>
            )}

            {provider === 'zoho_desk' && status && !status.zohoDeskConfigured && (
              <p className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-[13px] leading-relaxed text-amber-100">
                Zoho isn't set up on this server yet. Ask your KGT administrator to configure the Zoho OAuth app first.
              </p>
            )}

            <div>
              <Button variant="primary" onClick={connect} loading={busy === 'connect'}
                disabled={!!busy || (provider === 'zoho_desk' && status && !status.zohoDeskConfigured)}>
                {busy === 'connect' ? 'Verifying…' : `Connect ${PROVIDER_META[provider].label}`}
              </Button>
              <p className="mt-3 text-[12.5px] leading-relaxed text-fg-3">
                We verify the credentials before saving, so “Connected” always means a working link. Everything secret is stored encrypted and never shown again.
              </p>
            </div>
          </div>
        )}

        <div className="mt-7 border-t border-white/[0.06] pt-5">
          <div className="flex items-center justify-between">
            <h4 className="text-[13px] font-semibold text-fg">Recent ticket activity</h4>
            <button type="button" onClick={() => load({ silent: true })}
              className="text-[12px] font-medium text-fg-3 transition hover:text-fg">Refresh</button>
          </div>
          {logs.length ? (
            <ul className="mt-1 divide-y divide-white/[0.06]">{logs.map((log) => <LogRow key={log.id} log={log} />)}</ul>
          ) : (
            <p className="mt-3 text-[13px] text-fg-3">
              {connected ? 'No tickets pushed yet. Activity appears here as chats are escalated.' : 'Connect a helpdesk to start creating tickets from escalations.'}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
