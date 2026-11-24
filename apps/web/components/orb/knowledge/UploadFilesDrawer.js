import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Drawer, Button, Pill, Select, cx } from '..';
import { IconUpload, IconFile } from '../icons';
import { DOC_CATEGORIES } from '../../../lib/documentCategories';
import { clientWorkspace } from '../../../lib/api';

// Upload files — real file picking (browse + drag/drop) wired to the API.
// Each file uploads through ws.uploadFile (POST /documents/file) and shows its
// own status: Waiting → Uploading → Added / Skipped / Failed, mirroring the
// existing dashboard. The optional category files every section under one
// category; "Auto-detect" lets the API classify each section itself.
const CATEGORY_OPTIONS = [{ value: '', label: 'Auto-detect' }, ...DOC_CATEGORIES.map((c) => ({ value: c.id, label: c.short }))];
const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,.zip,application/pdf,application/zip,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const isAccepted = (f) => /\.(pdf|docx|txt|md|markdown|zip)$/i.test(f.name);
const isZip = (f) => /\.zip$/i.test(f.name);
const MAX_FILE_MB = 10;
const MAX_ZIP_MB = 25;
const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const STATUS_LABEL = { queued: 'Ready', uploading: 'Uploading', done: 'Added', skipped: 'Skipped', error: 'Failed' };
let uid = 0;

export default function UploadFilesDrawer({ open, onClose }) {
  const qc = useQueryClient();
  const ws = useMemo(() => clientWorkspace(), []);
  const inputRef = useRef(null);
  const [category, setCategory] = useState('');
  const [items, setItems] = useState([]); // { id, file, name, meta, status, detail, tone }
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    if (open) { setItems([]); setCategory(''); setBusy(false); setDrag(false); }
  }, [open]);

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []).map((file) => {
      const limit = isZip(file) ? MAX_ZIP_MB : MAX_FILE_MB;
      let status = 'queued', detail = 'Waiting', tone = 'neutral';
      if (!isAccepted(file)) { status = 'skipped'; detail = 'Unsupported type'; tone = 'yellow'; }
      else if (file.size > limit * 1024 * 1024) { status = 'skipped'; detail = `Larger than ${limit} MB`; tone = 'yellow'; }
      return { id: ++uid, file, name: file.name, meta: fmtSize(file.size), status, detail, tone };
    });
    setItems((prev) => [...prev, ...incoming]);
  };

  const patch = (id, next) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...next } : it)));
  const addable = items.filter((it) => it.status === 'queued');
  const anyDone = items.some((it) => it.status === 'done' || it.status === 'error');

  const upload = async () => {
    const queue = items.filter((it) => it.status === 'queued');
    if (!queue.length) return;
    setBusy(true);
    for (const it of queue) {
      patch(it.id, { status: 'uploading', detail: 'Uploading…', tone: 'neutral' });
      try {
        const r = await ws.uploadFile(it.file, category ? { category } : {});
        const skipped = (r.files || []).filter((x) => !x.ok);
        patch(it.id, {
          status: 'done',
          tone: 'tint',
          detail: `${r.documentsCreated} document${r.documentsCreated === 1 ? '' : 's'} added${skipped.length ? ` · ${skipped.length} skipped` : ''}`
        });
      } catch (err) {
        patch(it.id, { status: 'error', tone: 'yellow', detail: err.message || 'Upload failed' });
      }
    }
    qc.invalidateQueries({ queryKey: ['orb-documents'] });
    qc.invalidateQueries({ queryKey: ['orb-readiness'] });
    setBusy(false);
  };

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button onClick={onClose} disabled={busy}>{anyDone && !addable.length ? 'Done' : 'Cancel'}</Button>
      {addable.length > 0 && (
        <Button variant="primary" disabled={busy} className={busy ? 'opacity-45' : ''} onClick={upload}>
          {busy ? 'Uploading…' : `Add ${addable.length} file${addable.length === 1 ? '' : 's'}`}
        </Button>
      )}
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} title="Upload files" description="Orb reads the text. Images and scans without text are skipped." footer={footer}>
      <div className="flex flex-col gap-4">
        <Select fullWidth size="md" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} ariaLabel="Category for uploads" />

        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
          className={cx('flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink',
            drag ? 'border-orb-ink bg-orb-subtle' : 'border-orb-stroke bg-orb-subtle hover:border-orb-ink')}>
          <span className="text-orb-secondary"><IconUpload size={22} /></span>
          <span className="mt-2 orb-body-strong text-orb-ink">Drop files here, or browse</span>
          <span className="mt-0.5 orb-small text-orb-secondary">PDF, Word, TXT or MD up to 10 MB each. ZIP up to 25 MB.</span>
        </button>

        {items.length > 0 && (
          <ul className="flex flex-col gap-2">
            {items.map((it) => (
              <li key={it.id} className="flex items-center gap-3 rounded-xl border border-orb-hairline p-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orb-subtle text-orb-ink"><IconFile size={16} /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate orb-body-strong text-orb-ink">{it.name}</p>
                  <p className="truncate orb-small text-orb-secondary">{it.meta} · {it.detail}</p>
                </div>
                <Pill tone={it.tone}>{STATUS_LABEL[it.status]}</Pill>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
