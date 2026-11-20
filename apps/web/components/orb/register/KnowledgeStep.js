import { useRef, useState } from 'react';
import { Button, Pill, Modal, Field, Input, Textarea, Select } from '..';
import { OrbFormCard } from '../auth';
import { DOC_CATEGORIES, DEFAULT_CATEGORY, categoryLabel } from '../../../lib/documentCategories';
import { useAnalyzeFile } from '../../../lib/onboarding';
import ScanWebsiteDrawer from './ScanWebsiteDrawer';

// Step 3 (Figma 0D): add knowledge — three ways + the entries added so far.
// Controlled via the lifted `entries` state. Scan + Upload call the real
// analyze endpoints (nothing is persisted yet); Write adds a local entry.
//   entry: { id, title, content, category, scope, kind, sourceUrl?, consentUrl?, source? }

const WAYS = [
  { key: 'scan', title: 'Scan a website', desc: 'We read up to 12 pages, in about 30 seconds.', action: 'Scan' },
  { key: 'upload', title: 'Upload files', desc: 'PDF, Word, TXT or MD up to 10 MB each, or a ZIP up to 25 MB.', action: 'Choose files' },
  { key: 'write', title: 'Write an entry', desc: 'A title and text, for what your site doesn’t say.', action: 'Write' }
];
const CATEGORY_OPTIONS = DOC_CATEGORIES.map((c) => ({ value: c.id, label: c.short }));
const SCOPE_OPTIONS = [
  { value: 'AUTO', label: 'Auto-detect' },
  { value: 'BOTH', label: 'Both bots' },
  { value: 'SUPPORT', label: 'Support Bot only' },
  { value: 'SALES', label: 'Sales Bot only' }
];
const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.zip';
const ACCEPTED_RE = /\.(pdf|docx|txt|md|markdown|zip)$/i;
const hostOf = (url) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || url;

let idSeq = 0;
const makeId = () => `k${idSeq++}`;

const subFor = (e) =>
  e.kind === 'website' ? `Website · ${hostOf(e.consentUrl || e.sourceUrl || '')}`
    : e.kind === 'file' ? `File · ${e.source || ''}`
      : 'Written entry';

export default function KnowledgeStep({ entries, setEntries, onBack, onContinue }) {
  const [modal, setModal] = useState(null); // 'scan' | 'write' | null
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef(null);
  const analyzeFile = useAnalyzeFile();

  const add = (list) => setEntries((prev) => [...prev, ...list]);
  const remove = (id) => setEntries((prev) => prev.filter((e) => e.id !== id));

  const openWay = (key) => {
    if (key === 'upload') fileInputRef.current?.click();
    else setModal(key);
  };

  // Scan: the drawer runs the analyze + review; here we commit the chosen pages.
  const addScanned = (scanned, consentUrl) => {
    add(scanned.map((p) => ({
      id: makeId(), title: p.title, content: p.content, category: p.category,
      scope: 'AUTO', kind: 'website', sourceUrl: p.sourceUrl, consentUrl
    })));
    setModal(null);
  };

  // Upload: analyze each accepted file; map its sections into file entries.
  const handleFiles = async (fileList) => {
    setUploadError('');
    const files = Array.from(fileList || []).filter((f) => ACCEPTED_RE.test(f.name));
    for (const f of files) {
      try {
        const data = await analyzeFile.mutateAsync(f);
        const pages = (data.pages || []).map((p) => ({
          id: makeId(),
          title: p.title || f.name,
          content: p.content || '',
          category: p.category || DEFAULT_CATEGORY,
          scope: p.botScope || 'AUTO',
          kind: 'file',
          source: f.name
        }));
        if (pages.length) add(pages);
      } catch (err) {
        setUploadError(`${f.name}: ${err.message}`);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleWrite = ({ title, category, scope, text }) => {
    add([{ id: makeId(), title: title.trim(), content: text, category, scope, kind: 'manual' }]);
    setModal(null);
  };

  const totalChars = entries.reduce((sum, e) => sum + (e.content?.length || 0), 0);

  return (
    <OrbFormCard
      width={880}
      title="Add what Orb should know"
      subtitle="Three ways in. Use one or all of them; you can add more any time from Knowledge."
      footer={(
        <div className="flex items-center justify-between gap-3">
          <Button onClick={onBack}>Back</Button>
          <div className="flex items-center gap-3">
            <span className="orb-small text-orb-secondary">{entries.length ? 'Ready to continue' : 'Needs at least one entry'}</span>
            <Button variant="primary" size="md" onClick={onContinue} disabled={!entries.length}>Continue</Button>
          </div>
        </div>
      )}
    >
      <input ref={fileInputRef} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => handleFiles(e.target.files)} aria-hidden="true" />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {WAYS.map((w) => (
            <div key={w.key} className="flex flex-col rounded-xl border border-orb-hairline p-4">
              <p className="orb-body-strong text-orb-ink">{w.title}</p>
              <p className="mt-1 flex-1 orb-small text-orb-secondary">{w.desc}</p>
              <div className="mt-3">
                <Button onClick={() => openWay(w.key)} disabled={w.key === 'upload' && analyzeFile.isPending}>
                  {w.key === 'upload' && analyzeFile.isPending ? 'Reading…' : w.action}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {uploadError && <p className="orb-small text-red-600">{uploadError}</p>}

        <div className="rounded-[10px] bg-orb-subtle px-3.5 py-3">
          <p className="orb-small-strong text-orb-ink">Each entry has a category</p>
          <p className="mt-0.5 orb-small text-orb-secondary">FAQ is read first for patient questions. Policies &amp; pricing is trusted for money questions. Overview says what you do.</p>
        </div>

        <div className="overflow-hidden rounded-xl border border-orb-hairline">
          <div className="flex items-center justify-between bg-orb-subtle px-4 py-2.5">
            <span className="orb-small text-orb-tertiary">Added so far</span>
            <span className="orb-small text-orb-tertiary">{entries.length} entries · {totalChars.toLocaleString()} characters</span>
          </div>
          {entries.length === 0 ? (
            <p className="px-4 py-6 text-center orb-small text-orb-secondary">Nothing yet — scan your website, upload files, or write an entry above.</p>
          ) : (
            <ul className="divide-y divide-orb-hairline">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate orb-body-strong text-orb-ink">{e.title}</p>
                    <p className="truncate orb-small text-orb-secondary">{subFor(e)}</p>
                  </div>
                  <Pill tone="neutral">{categoryLabel(e.category)}</Pill>
                  <span className="w-32 shrink-0 text-right orb-small text-orb-secondary">{(e.content?.length || 0).toLocaleString()} characters</span>
                  <button type="button" onClick={() => remove(e.id)} className="shrink-0 orb-small-medium text-orb-ink underline focus:outline-none">Remove</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ScanWebsiteDrawer open={modal === 'scan'} onClose={() => setModal(null)} onAdd={addScanned} />
      <WriteEntryModal open={modal === 'write'} onClose={() => setModal(null)} onSave={handleWrite} />
    </OrbFormCard>
  );
}

// ── Write an entry: title + category + "Used by" (bot scope) + text.
function WriteEntryModal({ open, onClose, onSave }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('FAQ');
  const [scope, setScope] = useState('AUTO');
  const [text, setText] = useState('');
  const canSave = title.trim() && text.trim();

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <span className="orb-small text-orb-secondary">Orb uses it from the next chat.</span>
      <div className="flex gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} className={canSave ? '' : 'opacity-45'} onClick={() => onSave({ title, category, scope, text })}>Save entry</Button>
      </div>
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Write an entry" description="For what your website and files don’t say." footer={footer}>
      <div className="flex flex-col gap-5">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sunday branch hours" />
        </Field>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Category" helper="FAQ is read first for patient questions.">
            <Select fullWidth size="md" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} ariaLabel="Category" />
          </Field>
          <Field label="Used by" helper="Which bot answers from this entry.">
            <Select fullWidth size="md" value={scope} onChange={(e) => setScope(e.target.value)} options={SCOPE_OPTIONS} ariaLabel="Used by" />
          </Field>
        </div>
        <Field label="Text" helper={`Start a line with ## to split long text into sections. ${text.length} characters`}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={'## A question or topic\nThe answer, in plain words.'} />
        </Field>
      </div>
    </Modal>
  );
}
