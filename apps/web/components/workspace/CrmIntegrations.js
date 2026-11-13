import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Badge, Button, Card, CardHeader, Field, Select, Spinner, cx } from '../ui';
import { useToast } from '../ui/toast';

// CRM Integrations: connect a tenant's Zoho CRM so captured leads mirror into
// it and sales-rep status changes mirror back. The browser never sees OAuth
// tokens — "Connect" sends the user to Zoho's consent screen (authUrl from the
// API), and the backend callback stores the tokens and redirects back here
// with ?crm=connected|error, which this page turns into a toast.

// Zoho data centres, labelled for the selector. India leads because most of
// our tenants are on zoho.in — picking the wrong DC makes every API call fail.
const REGION_LABELS = {
  in: 'India (.in)',
  com: 'Global (.com)',
  eu: 'Europe (.eu)',
  au: 'Australia (.au)',
  jp: 'Japan (.jp)',
  ca: 'Canada (.ca)',
  sa: 'Saudi Arabia (.sa)'
};

const LOG_TONE = { SUCCESS: 'success', FAILED: 'danger', RETRYING: 'warning', PENDING: 'neutral' };
const OP_LABEL = { 'lead.upsert': 'Lead synced', 'note.attach': 'Note attached', 'webhook.status': 'Status update' };

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

function SyncLogRow({ log }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Badge tone={LOG_TONE[log.status] || 'neutral'}>{log.status}</Badge>
        <div className="min-w-0">
          <p className="truncate text-[13px] text-fg-2">
            {OP_LABEL[log.operation] || log.operation}
            <span className="text-fg-3"> · {log.direction === 'inbound' ? 'from Zoho' : 'to Zoho'}</span>
          </p>
          {log.status === 'FAILED' && log.error?.message && (
            <p className="truncate text-[11.5px] text-rose-300/90">{log.error.message}</p>
          )}
        </div>
      </div>
      <span className="shrink-0 text-[11.5px] text-fg-3">{timeAgo(log.createdAt)}</span>
    </li>
  );
}

export default function CrmIntegrations({ ws }) {
  const toast = useToast();
  const router = useRouter();
  const [status, setStatus] = useState(null);
  const [region, setRegion] = useState('in');
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    try {
      const s = await ws.getCrmStatus();
      setStatus(s);
      setRegion(s.region || 'in');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [ws, toast]);

  useEffect(() => { load(); }, [load]);

  // The OAuth callback redirects back with ?crm=connected|error. Show the
  // outcome, refresh status, then strip the query so a reload doesn't repeat it.
  useEffect(() => {
    if (!router.isReady) return;
    const { crm, reason } = router.query;
    if (crm !== 'connected' && crm !== 'error') return;
    if (crm === 'connected') { toast.success('Zoho CRM connected.'); load({ silent: true }); }
    else toast.error(`Couldn't connect Zoho CRM${reason ? ` (${reason})` : ''}. Please try again.`);
    router.replace('/dashboard/integrations', undefined, { shallow: true });
  }, [router.isReady, router.query.crm]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setConnecting(true);
    try {
      const r = await ws.connectCrm(region);
      if (r?.authUrl) {
        window.location.href = r.authUrl; // leave the SPA for Zoho's consent screen
        return; // keep the spinner while the browser navigates away
      }
      // Server-managed (Self Client): connected in place, no redirect.
      toast.success('Zoho CRM connected.');
      await load({ silent: true });
    } catch (e) {
      toast.error(e.message);
    } finally {
      // Only reset here for the in-place path; the redirect path has navigated away.
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await ws.disconnectCrm();
      toast.success('Zoho CRM disconnected.');
      await load({ silent: true });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return <Card className="flex items-center gap-2 p-6 text-sm text-fg-3"><Spinner className="h-4 w-4" />Loading integrations…</Card>;
  }

  const connected = !!status?.connected;
  const serverManaged = !!status?.serverManaged;
  const regions = status?.regions?.length ? status.regions : Object.keys(REGION_LABELS);
  const logs = status?.recentLogs || [];
  // The region is fixed by the server when it's server-managed, or once connected.
  const regionLocked = connected || serverManaged;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Zoho CRM"
        description="Sync captured leads into Zoho and keep lead statuses in step with your sales team — in both directions."
        icon={<span className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: '#E42527' }}>Z</span>}
        action={
          <Badge tone={connected ? 'success' : 'neutral'} dot>
            {connected ? 'Connected' : 'Not connected'}
          </Badge>
        }
      />

      <div className="p-5 sm:p-6">
        {/* Server-side OAuth app not configured: connecting can't work yet. */}
        {status && !status.configured && (
          <div className="mb-5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-[13px] leading-relaxed text-amber-100">
            Zoho isn't set up on this server yet. Ask your KGT administrator to configure the Zoho OAuth app, then connect from here.
          </div>
        )}
        {/* Linked, but outbound sync is globally off. */}
        {connected && status && !status.syncEnabled && (
          <div className="mb-5 rounded-xl border border-brand-400/25 bg-brand-400/[0.06] px-4 py-3 text-[13px] leading-relaxed text-brand-100">
            Connected. Automatic lead sync is currently turned off platform-wide — inbound status updates still apply, and outbound sync starts as soon as it's enabled.
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr),auto] sm:items-end">
          <Field
            label="Zoho data centre (region)"
            htmlFor="crm-region"
            hint={serverManaged
              ? 'Set by your server configuration — the account is linked to this data centre.'
              : 'Match the domain where your Zoho account lives, e.g. zoho.in for Indian accounts.'}>
            <Select
              id="crm-region"
              value={region}
              disabled={regionLocked}
              onChange={(e) => setRegion(e.target.value)}
              className="sm:max-w-xs">
              {regions.map((r) => <option key={r} value={r}>{REGION_LABELS[r] || r}</option>)}
            </Select>
          </Field>

          <div className="flex items-center gap-3">
            {connected ? (
              <Button variant="secondary" onClick={disconnect} loading={disconnecting} disabled={disconnecting}>
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            ) : (
              <Button variant="primary" onClick={connect} loading={connecting} disabled={connecting || !status?.configured}>
                {connecting ? 'Redirecting…' : 'Connect Zoho CRM'}
              </Button>
            )}
          </div>
        </div>

        {!connected && (
          <p className="mt-4 text-[12.5px] leading-relaxed text-fg-3">
            {serverManaged
              ? 'This server has Zoho credentials ready — connecting links your workspace in one click. Tokens are stored encrypted and never shown in the dashboard.'
              : "You'll be taken to Zoho to grant access, then returned here. Tokens are stored encrypted and are never shown in the dashboard."}
          </p>
        )}

        {/* Recent sync activity */}
        <div className="mt-7 border-t border-white/[0.06] pt-5">
          <div className="flex items-center justify-between">
            <h4 className="text-[13px] font-semibold text-fg">Recent sync activity</h4>
            <button type="button" onClick={() => load({ silent: true })}
              className="text-[12px] font-medium text-fg-3 transition hover:text-fg">Refresh</button>
          </div>
          {logs.length ? (
            <ul className="mt-1 divide-y divide-white/[0.06]">
              {logs.map((log) => <SyncLogRow key={log.id} log={log} />)}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] text-fg-3">
              {connected ? 'No syncs yet. Activity appears here as leads are captured and statuses change.' : 'Connect your account to start syncing leads.'}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
