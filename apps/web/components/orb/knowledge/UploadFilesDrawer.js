import { Drawer, Button, Pill } from '..';
import { IconUpload, IconFile } from '../icons';

// Right drawer: upload files — drop zone + the files picked, with per-file status.
const DEFAULT_FILES = [
  { name: 'Insurance and TPA panel.pdf', meta: '1.2 MB', status: { label: '4 sections', tone: 'tint' } },
  { name: 'Sunday timings.docx', meta: '84 KB', status: { label: '1 section', tone: 'tint' } },
  { name: 'price-list.pdf', meta: '220 KB · Not a real PDF inside. Export it again as PDF.', status: { label: 'Not added', tone: 'yellow' } },
  { name: 'clinic-photos.zip', meta: '3.4 MB · images with no text', status: { label: 'Not added', tone: 'yellow' } }
];

export default function UploadFilesDrawer({ open, onClose, files = DEFAULT_FILES, onAdd }) {
  const addable = files.filter((f) => f.status.tone !== 'yellow').length;
  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={onAdd}>{`Add ${addable} file${addable === 1 ? '' : 's'}`}</Button>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} title="Upload files" description="Orb reads the text. Images and scans without text are skipped." footer={footer}>
      <div className="flex flex-col gap-4">
        <button type="button" className="flex flex-col items-center justify-center rounded-xl border border-dashed border-orb-stroke bg-orb-subtle px-6 py-8 text-center transition-colors hover:border-orb-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink">
          <span className="text-orb-secondary"><IconUpload size={22} /></span>
          <span className="mt-2 orb-body-strong text-orb-ink">Drop files here, or browse</span>
          <span className="mt-0.5 orb-small text-orb-secondary">PDF, Word, TXT or MD up to 10 MB each. ZIP up to 25 MB.</span>
        </button>
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li key={f.name} className="flex items-center gap-3 rounded-xl border border-orb-hairline p-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orb-subtle text-orb-ink"><IconFile size={16} /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate orb-body-strong text-orb-ink">{f.name}</p>
                <p className="truncate orb-small text-orb-secondary">{f.meta}</p>
              </div>
              <Pill tone={f.status.tone}>{f.status.label}</Pill>
            </li>
          ))}
        </ul>
      </div>
    </Drawer>
  );
}
