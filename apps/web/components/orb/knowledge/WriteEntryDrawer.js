import { useState } from 'react';
import { Drawer, Field, Input, Textarea, Select, Button } from '..';

const CATEGORY_OPTIONS = [
  { value: 'faq', label: 'FAQ' },
  { value: 'policies', label: 'Policies & pricing' },
  { value: 'overview', label: 'Company overview' }
];

// Right drawer: write an entry (title + category + text).
export default function WriteEntryDrawer({ open, onClose, onSave }) {
  const [title, setTitle] = useState('Sunday branch hours');
  const [category, setCategory] = useState('policies');
  const [text, setText] = useState('## Sunday hours\nKharadi: 9 am to 1 pm, consultations by appointment. Baner and Wakad closed Sundays.');

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <span className="orb-small text-orb-secondary">Orb uses it from the next chat.</span>
      <div className="flex gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => onSave?.({ title, category, text })}>Save entry</Button>
      </div>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} title="Write an entry" description="For what your website and files don’t say." footer={footer}>
      <div className="flex flex-col gap-5">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Category" helper="FAQ is read first for patient questions.">
          <Select fullWidth size="md" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORY_OPTIONS} ariaLabel="Category" />
        </Field>
        <Field label="Text" helper={`Start a line with ## to split long text into sections. ${text.length} characters`}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} />
        </Field>
      </div>
    </Drawer>
  );
}
