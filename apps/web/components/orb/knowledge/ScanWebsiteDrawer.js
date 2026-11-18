import { useState } from 'react';
import { Drawer, Field, Input, Checkbox, Button } from '..';

// Right drawer: scan a website (URL + consent). Scan enables once consent ticked.
export default function ScanWebsiteDrawer({ open, onClose, onScan }) {
  const [url, setUrl] = useState('sanvifertility.in/insurance');
  const [consent, setConsent] = useState(false);

  const footer = (
    <div className="flex items-center justify-between gap-3">
      <span className="orb-small text-orb-secondary">Scan turns on once consent is ticked.</span>
      <div className="flex gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!consent} className={consent ? '' : 'opacity-45'} onClick={() => onScan?.(url)}>Scan</Button>
      </div>
    </div>
  );

  return (
    <Drawer open={open} onClose={onClose} title="Scan a website" description="Orb reads the page you paste and the pages it links to." footer={footer}>
      <div className="flex flex-col gap-5">
        <Field label="Website address" helper={`We’ll scan ${url} and the pages it links to: up to 12 pages`}>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="sanvifertility.in/…" />
        </Field>
        <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)}>
          <span className="block orb-body text-orb-ink">Sanvi Fertility &amp; IVF owns this site or may use its content to train Orb.</span>
          <span className="mt-1 block orb-small text-orb-secondary">We record who agreed and when. Not ticked by default.</span>
        </Checkbox>
      </div>
    </Drawer>
  );
}
