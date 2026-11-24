import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Button, Textarea, Pill, IconKey } from '..';
import { clientWorkspace } from '../../../lib/api';

// "Keys" — the tenant's API keys, wired to the workspace API. Lists every key
// with its label, prefix, allowed-websites and usage, and lets you edit
// websites or revoke (with a last-key guard). Issuing a new key — the label
// popup and the one-time "Copy your new key" reveal — lives in KeyIssuer, shared
// with the snippet buttons; the "Make a new key" header button just opens it.

const COLS = 'grid grid-cols-[1.1fr_140px_130px_84px_92px_150px] items-center gap-3';
const hostOf = (o) => { try { return new URL(o).host; } catch { return o; } };
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { return ''; } };

export default function KeysCard({ onMakeKey }) {
  const qc = useQueryClient();
  const ws = useMemo(() => clientWorkspace(), []);

  const { data: keys = [], isLoading, error } = useQuery({ queryKey: ['orb-api-keys'], queryFn: () => ws.listApiKeys() });
  const live = keys.filter((k) => !k.revokedAt);

  const [confirmId, setConfirmId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [originsDraft, setOriginsDraft] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState('');

  const refresh = () => qc.invalidateQueries({ queryKey: ['orb-api-keys'] });

  const revoke = async (k, force) => {
    setBusyId(k.id); setNote('');
    try {
      await ws.revokeApiKey(k.id, { force });
      setConfirmId(null);
      refresh();
    } catch (err) {
      setNote(err.message || 'Could not revoke that key.');
    } finally {
      setBusyId(null);
    }
  };

  const startEditing = (k) => { setEditingId(k.id); setOriginsDraft((k.allowedOrigins || []).join('\n')); };
  const saveOrigins = async (k) => {
    const list = originsDraft.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    setBusyId(k.id); setNote('');
    try {
      await ws.setApiKeyOrigins(k.id, list);
      setEditingId(null);
      refresh();
    } catch (err) {
      setNote(err.message || 'Could not save websites.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card
      title="Keys"
      subtitle="Each snippet carries a key. Revoke one and Orb stops on every page using it, straight away."
      headerRight={<Button onClick={onMakeKey}>Make a new key</Button>}
    >
      {note && <p className="mt-4 rounded-lg bg-orb-yellow px-3 py-2 orb-small text-orb-ink">{note}</p>}

      {/* Keys table */}
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[760px] overflow-hidden rounded-xl border border-orb-hairline">
          <div className={`${COLS} bg-orb-subtle px-4 py-2.5`}>
            {['Label', 'Key', 'Websites', 'Made', 'Last used', ''].map((h, i) => <span key={i} className="orb-heading text-orb-secondary">{h}</span>)}
          </div>

          {isLoading ? (
            <p className="px-4 py-6 orb-small text-orb-secondary">Loading keys…</p>
          ) : error ? (
            <p className="px-4 py-6 orb-small text-orb-ink">{error.message}</p>
          ) : keys.length === 0 ? (
            <p className="px-4 py-6 orb-small text-orb-secondary">No keys yet — issue one to embed Orb.</p>
          ) : (
            <ul className="divide-y divide-orb-hairline">
              {keys.map((k) => (
                <li key={k.id} className="px-4 py-3">
                  <div className={COLS}>
                    <span className="flex min-w-0 items-center gap-2 text-orb-secondary">
                      <IconKey size={16} />
                      <span className="truncate orb-body-strong text-orb-ink">{k.label}</span>
                    </span>
                    <span className="orb-code text-orb-secondary">{k.keyPrefix}••••••••</span>
                    <span className="flex min-w-0 items-center gap-1.5">
                      {k.allowedOrigins?.length
                        ? <span className="truncate orb-small text-orb-secondary" title={k.allowedOrigins.join('\n')}>{k.allowedOrigins.length === 1 ? hostOf(k.allowedOrigins[0]) : `${k.allowedOrigins.length} websites`}</span>
                        : <span className="orb-small text-orb-secondary">Any website</span>}
                      {!k.revokedAt && editingId !== k.id && (
                        <button type="button" onClick={() => startEditing(k)} className="shrink-0 orb-small-medium text-orb-ink hover:underline focus:outline-none">Edit</button>
                      )}
                    </span>
                    <span className="orb-body text-orb-secondary">{fmtDate(k.createdAt)}</span>
                    <span className="orb-body text-orb-secondary">{k.lastUsedAt ? fmtDate(k.lastUsedAt) : 'Never'}</span>
                    <span className="flex items-center justify-end gap-2">
                      {k.revokedAt ? (
                        <Pill tone="neutral">Revoked</Pill>
                      ) : confirmId === k.id ? (
                        <>
                          {live.length === 1 && <span className="orb-small text-orb-ink">Last key</span>}
                          <Button variant="primary" disabled={busyId === k.id} onClick={() => revoke(k, live.length === 1)}>Revoke</Button>
                          <Button onClick={() => setConfirmId(null)}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Pill tone="tint">Active</Pill>
                          <Button onClick={() => setConfirmId(k.id)}>Revoke</Button>
                        </>
                      )}
                    </span>
                  </div>

                  {/* Allowed-websites editor */}
                  {editingId === k.id && (
                    <div className="mt-3 rounded-xl border border-orb-hairline bg-orb-subtle p-3">
                      <label htmlFor={`origins-${k.id}`} className="orb-small text-orb-secondary">
                        Websites allowed to use this key — one per line, e.g. <span className="orb-code">https://www.acme.com</span>. Browsers on any other site are refused. Leave empty to allow any website.
                      </label>
                      <Textarea id={`origins-${k.id}`} rows={3} value={originsDraft} onChange={(e) => setOriginsDraft(e.target.value)} placeholder="https://www.acme.com" className="mt-2 orb-code" />
                      <div className="mt-2 flex gap-2">
                        <Button variant="primary" disabled={busyId === k.id} onClick={() => saveOrigins(k)}>{busyId === k.id ? 'Saving…' : 'Save websites'}</Button>
                        <Button onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="mt-3 orb-small text-orb-secondary">{live.length} active · stored as SHA-256 fingerprints only.</p>
    </Card>
  );
}
