import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Field, Input, Skeleton, cx } from '../ui';
import { useToast } from '../ui/toast';

// Generic outbound webhooks (Feature 8, services/webhooks.js). Register HTTP
// endpoints and subscribe each to one or more events; KGT POSTs a signed JSON
// envelope when they fire. The signing secret is shown ONCE (on create / rotate)
// and never again — the server only ever stores it encrypted. Works through `ws`,
// so everything stays scoped to the signed-in tenant.

const EVENT_LABELS = {
  'lead.created': 'New lead captured',
  'ticket.created': 'Ticket / escalation opened',
  'chat.session.completed': 'Conversation completed'
};

function fmtWhen(v) {
  if (!v) return null;
  try { return new Date(v).toLocaleString(); } catch { return String(v); }
}

const STATUS_TONE = { success: 'success', failed: 'danger' };

export default function WebhooksPanel({ ws }) {
  const toast = useToast();
  const [data, setData] = useState(null); // { webhooks, events, max }
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState('');
  const [desc, setDesc] = useState('');
  const [events, setEvents] = useState(['lead.created']);
  const [newSecret, setNewSecret] = useState(null); // { id, secret } shown once
  const [busyId, setBusyId] = useState(null);
  const [openLog, setOpenLog] = useState(null); // { webhookId, deliveries }

  const load = useCallback(async () => {
    try { setData(await ws.listWebhooks()); } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  }, [ws, toast]);
  useEffect(() => { load(); }, [load]);

  const allEvents = data?.events || Object.keys(EVENT_LABELS);
  const atMax = data && data.webhooks.length >= (data.max || 20);

  const toggleEvent = (ev) => setEvents((cur) => (cur.includes(ev) ? cur.filter((e) => e !== ev) : [...cur, ev]));

  const create = async () => {
    if (!url.trim()) { toast.error('Enter the URL to send events to.'); return; }
    if (!events.length) { toast.error('Choose at least one event.'); return; }
    setCreating(true);
    try {
      const created = await ws.createWebhook({ url: url.trim(), events, description: desc.trim() });
      setNewSecret({ id: created.id, secret: created.secret });
      setUrl(''); setDesc(''); setEvents(['lead.created']);
      toast.success('Webhook created. Copy its signing secret now — it won’t be shown again.');
      await load();
    } catch (e) { toast.error(e.message); } finally { setCreating(false); }
  };

  const toggleEnabled = async (hook, enabled) => {
    setBusyId(hook.id);
    try { await ws.updateWebhook(hook.id, { enabled }); await load(); }
    catch (e) { toast.error(e.message); } finally { setBusyId(null); }
  };

  const test = async (hook) => {
    setBusyId(hook.id);
    try {
      const res = await ws.testWebhook(hook.id);
      if (res.ok) toast.success(`Test delivered (HTTP ${res.statusCode}).`);
      else toast.error(`Test failed${res.statusCode ? ` (HTTP ${res.statusCode})` : ''}: ${res.error || 'no response'}`);
      await load();
    } catch (e) { toast.error(e.message); } finally { setBusyId(null); }
  };

  const rotate = async (hook) => {
    setBusyId(hook.id);
    try {
      const res = await ws.rotateWebhookSecret(hook.id);
      setNewSecret({ id: hook.id, secret: res.secret });
      toast.success('New signing secret generated. Copy it now — it won’t be shown again.');
    } catch (e) { toast.error(e.message); } finally { setBusyId(null); }
  };

  const remove = async (hook) => {
    setBusyId(hook.id);
    try { await ws.deleteWebhook(hook.id); if (openLog?.webhookId === hook.id) setOpenLog(null); await load(); }
    catch (e) { toast.error(e.message); } finally { setBusyId(null); }
  };

  const showLog = async (hook) => {
    if (openLog?.webhookId === hook.id) { setOpenLog(null); return; }
    try {
      const { deliveries } = await ws.listWebhookDeliveries(hook.id);
      setOpenLog({ webhookId: hook.id, deliveries: deliveries || [] });
    } catch (e) { toast.error(e.message); }
  };

  const copy = (text) => {
    try { navigator.clipboard?.writeText(text); toast.success('Copied to clipboard.'); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Outbound webhooks"
          description="Send a signed JSON payload to your own systems when a lead is captured, a ticket opens, or a conversation finishes. Each payload is signed (X-KGT-Signature) with the endpoint’s secret." />
        <div className="space-y-4 p-5">
          <Field label="Endpoint URL" htmlFor="wh-url" hint="We POST to this HTTPS URL. It must be publicly reachable.">
            <Input id="wh-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/kgt" disabled={creating || atMax} />
          </Field>
          <Field label="Description" htmlFor="wh-desc" hint="Optional — a note to help you recognise this endpoint.">
            <Input id="wh-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Zapier catch hook" disabled={creating || atMax} />
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-medium text-fg">Send these events</p>
            <div className="flex flex-col gap-2">
              {allEvents.map((ev) => (
                <Checkbox key={ev} checked={events.includes(ev)} onChange={() => toggleEvent(ev)} disabled={creating || atMax}>
                  <span className="text-[13px] text-fg-2">{EVENT_LABELS[ev] || ev} <span className="text-fg-3">· {ev}</span></span>
                </Checkbox>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button type="button" variant="primary" loading={creating} disabled={atMax} onClick={create}>Add webhook</Button>
            {atMax && <span className="text-[12px] text-fg-3">You’ve reached the maximum of {data.max} webhooks.</span>}
          </div>

          {newSecret && (
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/[0.06] p-4">
              <p className="text-[13px] font-semibold text-emerald-300">Signing secret — copy it now</p>
              <p className="mt-0.5 text-[12px] text-fg-3">Stored encrypted; it will never be shown again. Use it to verify the X-KGT-Signature header.</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-black/30 px-3 py-2 text-[12.5px] text-fg">{newSecret.secret}</code>
                <Button type="button" variant="secondary" onClick={() => copy(newSecret.secret)}>Copy</Button>
                <Button type="button" variant="ghost" onClick={() => setNewSecret(null)}>Dismiss</Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <div className="border-b border-white/[0.06] px-5 py-4">
          <h3 className="text-sm font-semibold text-fg">Your webhooks</h3>
          <p className="mt-0.5 text-[13px] text-fg-3">Enable or pause, send a test delivery, rotate the secret, or review recent deliveries.</p>
        </div>
        <div className="p-5">
          {loading ? (
            <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : !data?.webhooks.length ? (
            <EmptyState title="No webhooks yet">Add one above to start receiving events.</EmptyState>
          ) : (
            <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
              {data.webhooks.map((hook) => (
                <li key={hook.id} className="bg-white/[0.01] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={hook.enabled ? 'success' : 'neutral'} dot>{hook.enabled ? 'Active' : 'Paused'}</Badge>
                        {hook.lastStatus && <Badge tone={STATUS_TONE[hook.lastStatus] || 'neutral'}>last: {hook.lastStatus}</Badge>}
                        {hook.failureCount > 0 && <Badge tone="warning">{hook.failureCount} recent failure{hook.failureCount === 1 ? '' : 's'}</Badge>}
                      </div>
                      <p className="mt-1 truncate text-[13.5px] font-medium text-fg" title={hook.url}>{hook.url}</p>
                      {hook.description && <p className="text-[12px] text-fg-3">{hook.description}</p>}
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {(hook.events || []).map((ev) => <Badge key={ev} tone="blue">{EVENT_LABELS[ev] || ev}</Badge>)}
                      </div>
                      {hook.lastDeliveryAt && <p className="mt-1 text-[11.5px] text-fg-3">Last delivery: {fmtWhen(hook.lastDeliveryAt)}</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Checkbox checked={hook.enabled} disabled={busyId === hook.id} onChange={(e) => toggleEnabled(hook, e.target.checked)}>
                        <span className="text-[12px] text-fg-3">Enabled</span>
                      </Checkbox>
                      <Button type="button" variant="secondary" disabled={busyId === hook.id} onClick={() => test(hook)}>Test</Button>
                      <Button type="button" variant="ghost" disabled={busyId === hook.id} onClick={() => rotate(hook)}>Rotate secret</Button>
                      <Button type="button" variant="ghost" disabled={busyId === hook.id} onClick={() => showLog(hook)}>{openLog?.webhookId === hook.id ? 'Hide log' : 'Deliveries'}</Button>
                      <Button type="button" variant="danger" disabled={busyId === hook.id} onClick={() => remove(hook)}>Delete</Button>
                    </div>
                  </div>
                  {openLog?.webhookId === hook.id && (
                    <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/20 p-3">
                      {!openLog.deliveries.length ? (
                        <p className="text-[12.5px] text-fg-3">No deliveries recorded yet.</p>
                      ) : (
                        <ul className="max-h-60 space-y-1 overflow-auto text-[12.5px]">
                          {openLog.deliveries.map((d) => (
                            <li key={d.id} className="flex flex-wrap items-center gap-2">
                              <Badge tone={STATUS_TONE[d.status] || 'neutral'}>{d.status}</Badge>
                              <span className="text-fg-2">{d.event}</span>
                              <span className="text-fg-3">{d.statusCode ? `HTTP ${d.statusCode}` : 'no response'}{d.attempts > 1 ? ` · ${d.attempts} attempts` : ''}</span>
                              <span className={cx('text-fg-3', 'ml-auto')}>{fmtWhen(d.createdAt)}</span>
                              {d.error && <span className="w-full truncate text-rose-300" title={d.error}>{d.error}</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
