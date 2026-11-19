import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, EmptyState, Input, SecretField, Skeleton, Spinner } from '../ui';
import { useToast } from '../ui/toast';
import { IconAlert, IconCheck, IconCode, IconKey, IconLock } from '../ui/icons';
import EmbedSnippets from './EmbedSnippets';

// Has the widget actually loaded on the customer's site? Polls /install-status
// every 30s until it has (the widget pings on page load), then stops. Renders
// nothing until the first poll answers, so it never flickers "not installed"
// before we know.
const INSTALL_POLL_MS = 30_000;

function InstallStatus({ ws, refreshKey }) {
  const [status, setStatus] = useState(null);

  // refreshKey changes when a key is issued or revoked: re-run so polling resumes
  // and the status re-checks, instead of staying frozen on a now-stale "detected".
  useEffect(() => {
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const s = await ws.getInstallStatus();
        if (!active) return;
        setStatus(s);
        if (s.installed) return; // detected — stop polling
      } catch { /* transient — keep polling */ }
      if (active) timer = setTimeout(poll, INSTALL_POLL_MS);
    };
    poll();
    return () => { active = false; clearTimeout(timer); };
  }, [ws, refreshKey]);

  if (!status) return null;
  if (status.installed) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.07] px-3 py-2.5 text-[12.5px] text-emerald-100">
        <IconCheck className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Widget detected{status.url ? <> on <span className="font-medium">{status.url}</span></> : ''}
          {status.seenAt ? <span className="text-emerald-200/70"> · {new Date(status.seenAt).toLocaleString()}</span> : ''}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5 text-[12.5px] text-fg-3">
      <Spinner className="h-4 w-4 shrink-0" />
      Waiting for the widget&apos;s first load — paste a snippet on your site, then open the page.
    </div>
  );
}

// Credential vault. Keys are stored only as SHA-256 hashes on the server, so a
// key's full value exists in exactly one place: this browser tab, right after
// it's issued. That fresh key is shown masked with reveal + copy (and the
// matching embed snippet); every stored key shows its prefix, label and usage.

export default function KeyVault({ ws, tenant, freshKey }) {
  const toast = useToast();
  const [keys, setKeys] = useState(null);
  const [label, setLabel] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(freshKey ? { apiKey: freshKey, label: 'Website widget' } : null);
  const [confirmId, setConfirmId] = useState(null);

  const load = async () => {
    try {
      setKeys(await ws.listApiKeys());
    } catch (e) {
      toast.error(e.message);
    }
  };
  useEffect(() => { load(); }, [ws]);

  const issue = async (e) => {
    e.preventDefault();
    setIssuing(true);
    try {
      const created = await ws.createApiKey(label.trim() || 'Default');
      setIssued(created);
      setLabel('');
      toast.success('New key issued — copy it now, it can’t be shown again.');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIssuing(false);
    }
  };

  const revoke = async (k, force) => {
    try {
      await ws.revokeApiKey(k.id, { force });
      setConfirmId(null);
      toast.success(`Key ${k.keyPrefix}… revoked — requests using it are refused immediately.`);
      await load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const live = (keys || []).filter((k) => !k.revokedAt);
  // Changes whenever a key is issued or revoked, so InstallStatus re-checks.
  const keySignature = (keys || []).map((k) => `${k.id}:${k.revokedAt ? 'r' : 'a'}`).join(',');

  return (
    <div className="space-y-6">
      {issued && (
        <Card className="border-brand-400/25 shadow-glow">
          <CardHeader icon={<IconKey className="h-4 w-4" />} title={`New key${issued.label ? ` · ${issued.label}` : ''}`}
            description="Shown once. We only keep a fingerprint of it, so copy it somewhere safe before leaving this page." />
          <div className="space-y-4 p-5">
            <SecretField value={issued.apiKey} label="API key" />
            <EmbedSnippets slug={tenant.slug} apiKey={issued.apiKey} />
            <InstallStatus ws={ws} refreshKey={keySignature} />
          </div>
        </Card>
      )}

      {!issued && (
        <Card>
          <CardHeader icon={<IconCode className="h-4 w-4" />} title="Embed your bots"
            description="Two widgets, one per bot. Each is locked to its bot, so visitors get the right persona and knowledge on every page." />
          <div className="space-y-4 p-5">
            <EmbedSnippets slug={tenant.slug} />
            <InstallStatus ws={ws} refreshKey={keySignature} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Issue a key" description="Rotate without downtime: issue a new key, update the snippet on your site, then revoke the old one." />
        <form onSubmit={issue} className="flex flex-col gap-3 p-5 sm:flex-row">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. Production website" maxLength={80} aria-label="Key label" />
          <Button type="submit" variant="primary" loading={issuing}>Issue key</Button>
        </form>
      </Card>

      <Card>
        <CardHeader title="Keys" description={`${live.length} active · stored as SHA-256 fingerprints only`} icon={<IconLock className="h-4 w-4" />} />
        <div className="p-5">
          {!keys ? <Skeleton className="h-24" /> : keys.length === 0 ? (
            <EmptyState icon={<IconKey className="h-5 w-5" />} title="No keys yet">Issue one to embed your bots.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs text-fg-3">
                  <tr><th className="pb-2 font-medium">Key</th><th className="pb-2 font-medium">Label</th><th className="pb-2 font-medium">Created</th><th className="pb-2 font-medium">Last used</th><th className="pb-2 text-right font-medium">Status</th></tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td className="py-3 font-mono text-[13px] text-fg">{k.keyPrefix}<span className="text-fg-3">••••••••</span></td>
                      <td className="py-3 text-fg-2">{k.label}</td>
                      <td className="py-3 text-fg-3">{new Date(k.createdAt).toLocaleDateString()}</td>
                      <td className="py-3 text-fg-3">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}</td>
                      <td className="py-3 text-right">
                        {k.revokedAt ? <Badge>Revoked</Badge> : confirmId === k.id ? (
                          <span className="inline-flex items-center gap-2">
                            {live.length === 1 && <span className="inline-flex items-center gap-1 text-xs text-amber-200"><IconAlert className="h-3.5 w-3.5" />Last key</span>}
                            <Button size="sm" variant="danger" onClick={() => revoke(k, live.length === 1)}>Revoke</Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>Cancel</Button>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            <Badge tone="success" dot>Active</Badge>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmId(k.id)}>Revoke</Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
