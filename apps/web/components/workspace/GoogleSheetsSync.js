import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, Spinner } from '../ui';
import { useToast } from '../ui/toast';

// Google Sheets sync (Feature 8, services/sheetsSync.js). Connect a Google
// account (tokens live encrypted on the server, never here), pick a spreadsheet,
// and choose which events append a row. The connection reuses the same Google
// OAuth app as the email connection. Append is fire-and-forget on the server: a
// broken sheet never affects the chat or a lead capture.

const EVENT_LABELS = {
  'lead.created': 'New lead captured',
  'ticket.created': 'Ticket / escalation opened',
  'chat.session.completed': 'Conversation completed'
};

function fmtWhen(v) {
  if (!v) return null;
  try { return new Date(v).toLocaleString(); } catch { return String(v); }
}

export default function GoogleSheetsSync({ ws }) {
  const toast = useToast();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheetId, setSheetId] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [events, setEvents] = useState(['lead.created']);

  const load = useCallback(async () => {
    try {
      const s = await ws.getSheetsSync();
      setStatus(s);
      setSheetId(s.spreadsheetId || '');
      setSheetName(s.spreadsheetName || '');
      setEvents(s.events?.length ? s.events : ['lead.created']);
    } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  }, [ws, toast]);
  useEffect(() => { load(); }, [load]);

  // The OAuth callback redirects back here with ?sheets=connected|error.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const result = params.get('sheets');
    if (!result) return;
    if (result === 'connected') toast.success('Google account connected. Choose a spreadsheet below.');
    else toast.error(`Couldn’t connect Google Sheets${params.get('reason') ? ` (${params.get('reason')})` : ''}. Please try again.`);
    params.delete('sheets'); params.delete('reason');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, [toast]);

  const connect = async () => {
    setConnecting(true);
    try {
      const { authUrl } = await ws.connectSheets();
      if (authUrl) window.location.href = authUrl;
      else { toast.error('Could not start the connection.'); setConnecting(false); }
    } catch (e) { toast.error(e.message); setConnecting(false); }
  };

  const disconnect = async () => {
    setConnecting(true);
    try { setStatus(await ws.disconnectSheets()); toast.success('Google Sheets disconnected.'); }
    catch (e) { toast.error(e.message); } finally { setConnecting(false); }
  };

  const toggleEvent = (ev) => setEvents((cur) => (cur.includes(ev) ? cur.filter((e) => e !== ev) : [...cur, ev]));

  const save = async (patch) => {
    setSaving(true);
    try {
      const s = await ws.saveSheetsSettings(patch);
      setStatus(s);
      toast.success('Sheets sync settings saved.');
    } catch (e) { toast.error(e.message); } finally { setSaving(false); }
  };

  if (loading || !status) {
    return <Card className="flex items-center gap-2 p-6 text-sm text-fg-3"><Spinner className="h-4 w-4" />Loading Google Sheets…</Card>;
  }

  const allEvents = status.availableEvents || Object.keys(EVENT_LABELS);

  return (
    <Card>
      <CardHeader title="Google Sheets sync"
        description="Append a row to one of your Google Sheets whenever a lead, ticket or completed conversation comes in. Your sign-in is stored encrypted on the server, never in the browser."
        action={status.connected ? <Badge tone="success" dot>Connected</Badge> : null} />
      <div className="space-y-5 p-5">
        {!status.configured ? (
          <p className="text-[13px] leading-relaxed text-fg-3">
            Google sign-in isn’t set up on this server yet. Your administrator can enable it to use Google Sheets sync.
          </p>
        ) : !status.connected ? (
          <div>
            <p className="mb-3 text-[13px] leading-relaxed text-fg-3">Connect a Google account that can edit the spreadsheet you want rows added to.</p>
            <Button type="button" variant="primary" loading={connecting} onClick={connect}>Connect Google account</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-fg">{status.email || 'Google account'}</p>
                <p className="text-[12px] text-fg-3">Connected{status.connectedAt ? ` ${fmtWhen(status.connectedAt)}` : ''}{status.connectedBy ? ` by ${status.connectedBy}` : ''}.</p>
              </div>
              <Button type="button" variant="danger" loading={connecting} onClick={disconnect}>Disconnect</Button>
            </div>

            <Field label="Spreadsheet ID or link" htmlFor="sheet-id"
              hint="Paste the sheet’s URL or its ID (the long code in the URL). Make sure the connected account can edit it.">
              <Input id="sheet-id" value={sheetId} onChange={(e) => setSheetId(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" disabled={saving} />
            </Field>
            <Field label="Tab name" htmlFor="sheet-tab" hint="Which tab to append to. Leave blank for the first tab (Sheet1).">
              <Input id="sheet-tab" value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="Sheet1" disabled={saving} />
            </Field>

            <div>
              <p className="mb-2 text-[13px] font-medium text-fg">Append a row for these events</p>
              <div className="flex flex-col gap-2">
                {allEvents.map((ev) => (
                  <Checkbox key={ev} checked={events.includes(ev)} onChange={() => toggleEvent(ev)} disabled={saving}>
                    <span className="text-[13px] text-fg-2">{EVENT_LABELS[ev] || ev} <span className="text-fg-3">· {ev}</span></span>
                  </Checkbox>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" loading={saving}
                onClick={() => save({ spreadsheetId: sheetId.trim(), spreadsheetName: sheetName.trim(), events })}>
                Save settings
              </Button>
              <Checkbox checked={status.enabled} disabled={saving}
                onChange={(e) => save({ spreadsheetId: sheetId.trim(), spreadsheetName: sheetName.trim(), events, enabled: e.target.checked })}>
                <span className="text-[12.5px] text-fg-2">{status.enabled ? 'Syncing is on' : 'Syncing is off'}</span>
              </Checkbox>
              {status.lastStatus && (
                <span className="text-[12px] text-fg-3">Last: {status.lastStatus}{status.lastSyncAt ? ` · ${fmtWhen(status.lastSyncAt)}` : ''}</span>
              )}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
