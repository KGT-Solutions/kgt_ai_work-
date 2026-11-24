import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Pill, Checkbox, Modal, Field } from '..';
import { clientWorkspace } from '../../../lib/api';

// Shared "issue a key" flow for the Install page. useKeyIssuer() owns the two
// dialogs — the "Make a new key" label modal and the "Copy your new key" reveal
// (Figma · Dialog · Copy your new key) — and returns { open, modals }. The page
// renders {modals} once and hands open() to every "make a key" button (Keys
// card header, each snippet), so they all open the same popup. Issuing
// invalidates ['orb-api-keys'], so the Keys table refreshes on its own.

const KEY_STEPS = [
  'Swap the old key for this one in both snippets on your site.',
  'Open a page and check Orb answers — “Last used” changes from “Never”.',
  'Revoke the old key in the Keys list below.'
];

function CopyButton({ value, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  };
  return <Button onClick={copy}>{done ? 'Copied' : label}</Button>;
}

export function useKeyIssuer() {
  const qc = useQueryClient();
  const ws = useMemo(() => clientWorkspace(), []);

  const [modalOpen, setModalOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(null); // { apiKey, label } — shown once
  const [copied, setCopied] = useState(false); // "I've copied the key" gate
  const [note, setNote] = useState('');

  const open = () => { setLabel(''); setNote(''); setModalOpen(true); };
  const dismissIssued = () => { setIssued(null); setCopied(false); };

  const issue = async (e) => {
    e?.preventDefault?.();
    setIssuing(true); setNote('');
    try {
      const created = await ws.createApiKey(label.trim() || 'Default');
      setIssued({ apiKey: created.apiKey, label: created.label });
      setCopied(false);
      setLabel('');
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['orb-api-keys'] });
    } catch (err) {
      setNote(err.message || 'Could not issue a key.');
    } finally {
      setIssuing(false);
    }
  };

  const modals = (
    <>
      {/* "Make a new key" — label the key before issuing */}
      <Modal
        open={modalOpen}
        onClose={() => { if (!issuing) setModalOpen(false); }}
        title="Make a new key"
        description="Give it a label so you can recognise it later. The full key is shown once, right after."
        footer={(
          <div className="flex flex-col items-stretch gap-2">
            {note && <p className="rounded-lg bg-orb-yellow px-3 py-2 orb-small text-orb-ink">{note}</p>}
            <div className="flex items-center justify-end gap-2">
              <Button onClick={() => setModalOpen(false)} disabled={issuing}>Cancel</Button>
              <Button variant="primary" disabled={issuing} className={issuing ? 'opacity-45' : ''} onClick={issue}>{issuing ? 'Issuing…' : 'Issue key'}</Button>
            </div>
          </div>
        )}
      >
        <form onSubmit={issue}>
          <Field label="Label">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Production website" maxLength={80} aria-label="Key label" autoFocus />
          </Field>
        </form>
      </Modal>

      {/* "Copy your new key" dialog (Figma · Dialog · Copy your new key) —
          the fresh key is shown once, right after issuing. */}
      <Modal open={!!issued} onClose={dismissIssued} title="Copy your new key" width={520}>
        {/* Warning — this is the only time the whole key is shown */}
        <div className="rounded-xl bg-orb-subtle p-3.5">
          <Pill tone="yellow">Copy it now</Pill>
          <p className="mt-2 orb-small text-orb-secondary">This is the only time you’ll see the whole key. If you lose it, make another one.</p>
        </div>

        {/* Key + copy */}
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-orb-hairline bg-orb-white px-3.5 py-2">
          <code className="min-w-0 flex-1 truncate orb-code text-orb-ink">{issued?.apiKey}</code>
          <CopyButton value={issued?.apiKey || ''} label="Copy key" />
        </div>

        {/* Then — numbered steps */}
        <div className="mt-5">
          <p className="orb-small-medium text-orb-secondary">Then</p>
          <ol className="mt-3 space-y-2.5">
            {KEY_STEPS.map((step, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-orb-subtle orb-micro text-orb-secondary">{i + 1}</span>
                <span className="orb-body text-orb-ink">{step}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* I've copied the key · Done */}
        <div className="mt-6 flex items-center justify-between">
          <Checkbox checked={copied} onChange={(e) => setCopied(e.target.checked)}>I’ve copied the key</Checkbox>
          <Button variant="primary" disabled={!copied} className={copied ? '' : 'opacity-45'} onClick={dismissIssued}>Done</Button>
        </div>
      </Modal>
    </>
  );

  return { open, modals };
}
