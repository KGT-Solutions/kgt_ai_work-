import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Badge, Button, Card, CardHeader, Spinner } from '../ui';
import { useToast } from '../ui/toast';

// HubSpot CRM (Feature 9): connect a tenant's HubSpot account so captured leads
// mirror into it as Contacts and lifecycle/lead-status changes mirror back. The
// browser never sees OAuth tokens — "Connect" sends the user to HubSpot's consent
// screen (authUrl from the API), and the backend callback stores the tokens and
// redirects back here with ?hubspot=connected|error, which this turns into a toast.
// One CRM per workspace, so connect is disabled while Zoho holds the slot.

const LOG_TONE = { SUCCESS: 'success', FAILED: 'danger', RETRYING: 'warning', PENDING: 'neutral' };
const OP_LABEL = { 'lead.upsert': 'Contact synced', 'note.attach': 'Note attached', 'webhook.status': 'Status update' };

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
            <span className="text-fg-3"> · {log.direction === 'inbound' ? 'from HubSpot' : 'to HubSpot'}</span>
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

export default function HubspotIntegration({ ws }) {
  const toast = useToast();
  const router = useRouter();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    try {
      setStatus(await ws.getHubspotStatus());
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [ws, toast]);

  useEffect(() => { load(); }, [load]);

  // The OAuth callback redirects back with ?hubspot=connected|error. Show the
  // outcome, refresh status, then strip the query so a reload doesn't repeat it.
  useEffect(() => {
    if (!router.isReady) return;
    const { hubspot, reason } = router.query;
    if (hubspot !== 'connected' && hubspot !== 'error') return;
    if (hubspot === 'connected') { toast.success('HubSpot CRM connected.'); load({ silent: true }); }
    else if (reason === 'conflict') toast.error('Disconnect Zoho first — a workspace can connect one CRM at a time.');
    else toast.error(`Couldn't connect HubSpot${reason ? ` (${reason})` : ''}. Please try again.`);
    router.replace('/dashboard/integrations', undefined, { shallow: true });
  }, [router.isReady, router.query.hubspot]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async () => {
    setConnecting(true);
    try {
      const r = await ws.connectHubspot();
      if (r?.authUrl) {
        window.location.href = r.authUrl; // leave the SPA for HubSpot's consent screen
        return; // keep the spinner while the browser navigates away
      }
      toast.success('HubSpot CRM connected.');
      await load({ silent: true });
    } catch (e) {
      toast.error(e.message);
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      await ws.disconnectHubspot();
      toast.success('HubSpot CRM disconnected.');
      await load({ silent: true });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return <Card className="flex items-center gap-2 p-6 text-sm text-fg-3"><Spinner className="h-4 w-4" />Loading HubSpot…</Card>;
  }

  const connected = !!status?.connected;
  const blockedBy = status?.blockedBy || null;
  const logs = status?.recentLogs || [];

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="HubSpot CRM"
        description="Sync captured leads into HubSpot as Contacts and keep lead statuses in step with your sales team — in both directions."
        icon={<span className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white" style={{ backgroundColor: '#FF7A59' }}>H</span>}
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
            HubSpot isn't set up on this server yet. Ask your KGT administrator to configure the HubSpot OAuth app, then connect from here.
          </div>
        )}
        {/* One CRM per workspace: another provider holds the slot. */}
        {status && status.configured && !connected && blockedBy && (
          <div className="mb-5 rounded-xl border border-brand-400/25 bg-brand-400/[0.06] px-4 py-3 text-[13px] leading-relaxed text-brand-100">
            {blockedBy === 'ZOHO' ? 'Zoho' : blockedBy} CRM is connected. A workspace syncs with one CRM at a time — disconnect it above to switch to HubSpot.
          </div>
        )}
        {/* Linked, but outbound sync is globally off. */}
        {connected && status && !status.syncEnabled && (
          <div className="mb-5 rounded-xl border border-brand-400/25 bg-brand-400/[0.06] px-4 py-3 text-[13px] leading-relaxed text-brand-100">
            Connected. Automatic lead sync is currently turned off platform-wide — inbound status updates still apply, and outbound sync starts as soon as it's enabled.
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="max-w-xl text-[12.5px] leading-relaxed text-fg-3">
            {connected
              ? `Linked${status?.portalId ? ` to HubSpot account ${status.portalId}` : ''}. Tokens are stored encrypted and never shown in the dashboard.`
              : "You'll be taken to HubSpot to grant access, then returned here. Tokens are stored encrypted and are never shown in the dashboard."}
          </p>
          <div className="flex items-center gap-3">
            {connected ? (
              <Button variant="secondary" onClick={disconnect} loading={disconnecting} disabled={disconnecting}>
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            ) : (
              <Button variant="primary" onClick={connect} loading={connecting}
                disabled={connecting || !status?.configured || !!blockedBy}>
                {connecting ? 'Redirecting…' : 'Connect HubSpot CRM'}
              </Button>
            )}
          </div>
        </div>

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
