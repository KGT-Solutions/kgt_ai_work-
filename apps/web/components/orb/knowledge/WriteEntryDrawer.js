import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Drawer, Field, Input, Textarea, Select, Button } from '..';
import { DOC_CATEGORIES, DEFAULT_CATEGORY } from '../../../lib/documentCategories';
import { clientWorkspace } from '../../../lib/api';

// Write an entry — a single-step form wired to the real API. Category options
// are the DocumentCategory enum (CORE_OVERVIEW / FAQ / CUSTOM_POLICY) so no
// mapping is needed. Save creates the document and refreshes the table +
// readiness card.
const CATEGORY_OPTIONS = DOC_CATEGORIES.map((c) => ({ value: c.id, label: c.short }));

export default function WriteEntryDrawer({ open, onClose }) {
  const qc = useQueryClient();
  const ws = useMemo(() => clientWorkspace(), []);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(DEFAULT_CATEGORY);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Clean form each time the drawer opens.
  useEffect(() => {
    if (open) { setTitle(''); setCategory(DEFAULT_CATEGORY); setText(''); setSaving(false); setError(''); }
  }, [open]);

  const save = async () => {
    if (!title.trim()) return setError('Add a title.');
    if (!text.trim()) return setError('Add some text — Orb answers from this.');
    setSaving(true);
    setError('');
    try {
      await ws.createDocument({ title: title.trim(), content: text, category });
      qc.invalidateQueries({ queryKey: ['orb-documents'] });
      qc.invalidateQueries({ queryKey: ['orb-readiness'] });
      onClose?.();
    } catch (err) {
      setError(err.message || 'Could not save that entry.');
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <span className="orb-small text-orb-secondary">Orb uses it from the next chat.</span>
      <div className="flex gap-2">
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" disabled={saving} className={saving ? 'opacity-45' : ''} onClick={save}>{saving ? 'Saving…' : 'Save entry'}</Button>
      </div>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} title="Write an entry" description="For what your website and files don’t say." footer={footer}>
      <div className="flex flex-col gap-5">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sunday branch hours" />
        </Field>
        <Field label="Category" helper="FAQ is read first for patient questions.">
          <Select fullWidth size="md" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} ariaLabel="Category" />
        </Field>
        <Field label="Text" helper={`Start a line with ## to split long text into sections. ${text.length} characters`}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={'## Sunday hours\nKharadi: 9 am to 1 pm, consultations by appointment.'} />
        </Field>
        {error && <p className="rounded-lg bg-orb-yellow px-3 py-2 orb-small text-orb-ink">{error}</p>}
      </div>
    </Drawer>
  );
}
