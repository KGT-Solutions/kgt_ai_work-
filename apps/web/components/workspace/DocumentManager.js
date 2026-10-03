import { useEffect, useRef, useState } from 'react';
import { DOC_CATEGORIES, DEFAULT_CATEGORY, categoryLabel } from '../../lib/documentCategories';
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Field, Input, Segmented, Select, Skeleton, Spinner, Textarea, cx } from '../ui';
import { useToast } from '../ui/toast';
import { IconCheck, IconDocs, IconGlobe, IconPencil, IconSearch, IconTrash, IconUpload, IconX, IconAlert } from '../ui/icons';

// Knowledge for one tenant: drag-and-drop uploads with live per-file status,
// write/paste entries, website import, and the document list. Works through
// `ws` (clientWorkspace() or staffWorkspace(id)), so it can only ever reach
// the tenant the session is allowed to.

const MAX_PDF_MB = 10;
const MAX_TEXT_KB = 200;
// Must match CRAWL_CONSENT_STATEMENT in apps/api/src/services/shared/crawlConsent.js.
const CRAWL_CONSENT_TEXT =
  'I am an authorized representative and legally permit the KGT Solutions AI crawler to access and extract content from this domain.';

const isPdf = (f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
const isText = (f) => /\.(txt|md|markdown)$/i.test(f.name) || /^text\/(plain|markdown)$/.test(f.type);

export default function DocumentManager({ ws, audience }) {
  const toast = useToast();
  const [docs, setDocs] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('upload');

  const load = async () => {
    try {
      setDocs(await ws.listDocuments());
    } catch (e) {
      toast.error(e.message);
    }
  };
  useEffect(() => { load(); }, [ws]);

  const q = query.trim().toLowerCase();
  const visible = (docs || []).filter((d) => (filter === 'ALL' || d.category === filter) &&
    (!q || d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q)));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Add knowledge" description="Both bots learn from everything here. Changes apply on the very next question."
          action={<Segmented label="How to add" value={mode} onChange={setMode}
            options={[{ value: 'upload', label: 'Upload files' }, { value: 'write', label: 'Write' }, { value: 'website', label: 'Website' }]} />} />
        <div className="p-5">
          {mode === 'upload' && <UploadZone ws={ws} onAdded={load} />}
          {mode === 'write' && <WriteEntry ws={ws} onAdded={load} />}
          {mode === 'website' && <WebsiteImport ws={ws} audience={audience} onAdded={load} />}
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3 border-b border-white/[0.06] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-fg">Training documents</h3>
            <p className="mt-0.5 text-[13px] text-fg-3">
              FAQs guide the Support Bot first, Overview guides the Sales Bot, Policies are authoritative for prices and rules.
            </p>
          </div>
          <div className="relative sm:w-64">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search documents" className="pl-9" aria-label="Search documents" />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 px-5 pt-4">
          {[{ id: 'ALL', short: 'All' }, ...DOC_CATEGORIES].map((c) => {
            const n = c.id === 'ALL' ? (docs || []).length : (docs || []).filter((d) => d.category === c.id).length;
            return (
              <button key={c.id} type="button" onClick={() => setFilter(c.id)} aria-pressed={filter === c.id}
                className={cx('rounded-full border px-3 py-1 text-xs font-medium transition',
                  filter === c.id ? 'border-brand-400/40 bg-brand-400/10 text-brand-100' : 'border-white/10 text-fg-3 hover:text-fg-2')}>
                {c.short} <span className="tabular-nums text-fg-3">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="p-5">
          {!docs ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : visible.length === 0 ? (
            <EmptyState icon={<IconDocs className="h-5 w-5" />} title={docs.length ? 'Nothing matches' : 'No documents yet'}>
              {docs.length ? 'Try another section or search.' : 'Upload a PDF, write an entry, or import your website — the bots answer only from what’s here.'}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
              {visible.map((d) => <DocumentRow key={d.id} ws={ws} doc={d} onChanged={load} />)}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── Drag-and-drop upload with live per-file status
function UploadZone({ ws, onAdded }) {
  const [drag, setDrag] = useState(false);
  const [category, setCategory] = useState(''); // '' = auto-detect
  const [items, setItems] = useState([]); // { id, name, status: queued|parsing|done|error, detail }
  const busy = items.some((i) => i.status === 'queued' || i.status === 'parsing');
  const inputRef = useRef(null);
  const nextId = useRef(0);

  const patch = (id, p) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length || busy) return;
    const queued = files.map((f) => ({ id: nextId.current++, name: f.name, size: f.size, status: 'queued', file: f }));
    setItems(queued);
    let added = 0;
    // One at a time: honest progress, and the API's per-tenant limits stay happy.
    for (const it of queued) {
      const f = it.file;
      patch(it.id, { status: 'parsing' });
      try {
        if (isPdf(f)) {
          if (f.size > MAX_PDF_MB * 1024 * 1024) throw new Error(`Larger than ${MAX_PDF_MB}MB`);
          const r = await ws.uploadPdf(f, category);
          added += r.documentsCreated;
          patch(it.id, { status: 'done', detail: `${r.documentsCreated} section${r.documentsCreated === 1 ? '' : 's'}${r.truncated ? ' (long file — first part only)' : ''}` });
        } else if (isText(f)) {
          if (f.size > MAX_TEXT_KB * 1024) throw new Error(`Text files are limited to ${MAX_TEXT_KB}KB`);
          const content = (await f.text()).trim();
          if (!content) throw new Error('The file is empty');
          await ws.createDocument({ title: f.name.replace(/\.(txt|md|markdown)$/i, ''), content, category: category || DEFAULT_CATEGORY });
          added += 1;
          patch(it.id, { status: 'done', detail: `Added to ${categoryLabel(category || DEFAULT_CATEGORY)}` });
        } else {
          throw new Error('Use a PDF, .txt or .md file');
        }
      } catch (err) {
        patch(it.id, { status: 'error', detail: err.message });
      }
    }
    if (inputRef.current) inputRef.current.value = '';
    if (added) await onAdded();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13px] text-fg-2">File sections under</span>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 w-auto min-w-[220px]" aria-label="Section for uploads">
          <option value="">Auto-detect for each part</option>
          {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </Select>
      </div>

      {/* The whole zone is a <label> for the file input: a click opens the native picker directly. */}
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
        className={cx('relative flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center transition focus-within:ring-4 focus-within:ring-brand-400/10',
          drag ? 'border-brand-400/70 bg-brand-400/[0.06] shadow-glow' : 'border-white/15 bg-white/[0.015] hover:border-white/25 hover:bg-white/[0.03]',
          busy && 'pointer-events-none opacity-70')}>
        <input ref={inputRef} type="file" multiple accept="application/pdf,.pdf,.txt,.md,.markdown,text/plain,text/markdown"
          className="absolute h-px w-px opacity-0" onChange={(e) => handleFiles(e.target.files)} disabled={busy} />
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-brand-300">
          <IconUpload className="h-5 w-5" />
        </span>
        <p className="text-sm font-medium text-fg">Drop files here, or click to browse</p>
        <p className="mt-1 text-xs text-fg-3">PDF up to {MAX_PDF_MB}MB · .txt and .md up to {MAX_TEXT_KB}KB · several at once</p>
      </label>

      {items.length > 0 && (
        <ul className="space-y-1.5" aria-live="polite">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[13px]">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                {i.status === 'parsing' && <Spinner className="h-4 w-4 text-brand-300" />}
                {i.status === 'queued' && <span className="h-2 w-2 rounded-full bg-fg-3" />}
                {i.status === 'done' && <IconCheck className="h-4 w-4 text-emerald-300" />}
                {i.status === 'error' && <IconAlert className="h-4 w-4 text-rose-300" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-fg">{i.name}</span>
              <span className={cx('shrink-0 text-xs', i.status === 'error' ? 'text-rose-300' : 'text-fg-3')}>
                {i.status === 'queued' ? 'Waiting' : i.status === 'parsing' ? 'Parsing…' : i.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Write or paste an entry
function WriteEntry({ ws, onAdded }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const save = async (e) => {
    e.preventDefault();
    if (!title.trim()) return setProblem('Add a title.');
    if (!content.trim()) return setProblem('Add some content — the bots answer from this text.');
    setBusy(true);
    setProblem('');
    try {
      await ws.createDocument({ title: title.trim(), content, category });
      toast.success(`“${title.trim()}” added to ${categoryLabel(category)}.`);
      setTitle('');
      setContent('');
      await onAdded();
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
        <Field label="Title" htmlFor="doc-title"><Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Returns policy" /></Field>
        <Field label="Section" htmlFor="doc-cat">
          <Select id="doc-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Content" htmlFor="doc-content" error={problem}
        hint={<>Split into <code className="text-fg-2">## Heading</code> sections — each becomes one retrievable chunk. Tag a Sales highlight with <code className="text-fg-2">{'<!-- tags: benefit:free_shipping -->'}</code>.</>}>
        <Textarea id="doc-content" value={content} onChange={(e) => setContent(e.target.value)} className="min-h-[180px] font-mono text-[13px]"
          placeholder={'## Returns\nItems can be returned within 30 days…\n\n## Shipping\nStandard delivery takes 3–5 business days.'} />
      </Field>
      <Button type="submit" variant="primary" loading={busy}>Save document</Button>
    </form>
  );
}

// ── Website import
function WebsiteImport({ ws, audience, onAdded }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const isClient = audience === 'client';

  const run = async (e) => {
    e.preventDefault();
    if (!url.trim()) return setProblem('Enter your website address, e.g. https://example.com');
    if (isClient && !authorized) return setProblem('Tick the authorization box to continue.');
    setBusy(true);
    setProblem('');
    try {
      const r = await ws.importWebsite(url.trim(), { authorized });
      toast.success(r.message);
      setUrl('');
      await onAdded();
    } catch (err) {
      setProblem(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={run} className="space-y-4" noValidate>
      <Field label="Website" htmlFor="import-url" error={problem}
        hint={`Crawls up to 12 same-domain pages (About, FAQ, Support, Pricing and pages linked from them) and adds each as a document.${isClient ? '' : ' Staff imports also render JavaScript-only sites.'}`}>
        <div className="relative">
          <IconGlobe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
          <Input id="import-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" className="pl-9" disabled={busy} />
        </div>
      </Field>
      {isClient && <Checkbox checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} disabled={busy}>{CRAWL_CONSENT_TEXT}</Checkbox>}
      <Button type="submit" variant="primary" loading={busy} disabled={!url.trim() || (isClient && !authorized)}>
        {busy ? 'Importing pages — up to a minute…' : 'Import website'}
      </Button>
    </form>
  );
}

// ── One document: view, edit, delete
function DocumentRow({ ws, doc, onChanged }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: doc.title, content: doc.content, category: doc.category || DEFAULT_CATEGORY });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const save = async () => {
    if (!draft.title.trim() || !draft.content.trim()) return toast.error('Title and content cannot be empty.');
    setBusy(true);
    try {
      await ws.updateDocument(doc.id, { ...draft, title: draft.title.trim() });
      toast.success('Document updated.');
      setEditing(false);
      await onChanged();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await ws.deleteDocument(doc.id);
      toast.success(`“${doc.title}” deleted.`);
      await onChanged();
    } catch (e) {
      toast.error(e.message);
      setBusy(false);
    }
  };

  const tone = { FAQ: 'blue', CORE_OVERVIEW: 'green', CUSTOM_POLICY: 'warning' }[doc.category] || 'neutral';

  return (
    <li className="bg-white/[0.01]">
      <div className="flex items-start gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium text-fg">{doc.title}</span>
            <Badge tone={tone}>{categoryLabel(doc.category)}</Badge>
            {doc.sourceUrl && <Badge><IconGlobe className="h-3 w-3" />Website</Badge>}
          </div>
          <p className="mt-1 line-clamp-1 text-xs text-fg-3">{doc.content.replace(/\s+/g, ' ').slice(0, 200)}</p>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {confirm ? (
            <>
              <span className="mr-1 hidden text-xs text-fg-3 sm:inline">Delete from both bots?</span>
              <Button size="sm" variant="danger" onClick={remove} loading={busy}>Delete</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)} aria-label="Cancel"><IconX className="h-3.5 w-3.5" /></Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(true); setOpen(true); }} aria-label={`Edit ${doc.title}`}><IconPencil className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label={`Delete ${doc.title}`}><IconTrash className="h-3.5 w-3.5" /></Button>
            </>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t border-white/[0.05] px-4 py-4">
          {editing ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
                <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Title" />
                <Select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} aria-label="Section">
                  {DOC_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </Select>
              </div>
              <Textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} className="min-h-[220px] font-mono text-[13px]" aria-label="Content" />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" onClick={save} loading={busy}>Save</Button>
                <Button size="sm" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[12.5px] leading-relaxed text-fg-2">{doc.content}</pre>
          )}
          {doc.sourceUrl && !editing && (
            <a href={doc.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-brand-300 hover:underline">{doc.sourceUrl}</a>
          )}
        </div>
      )}
    </li>
  );
}
