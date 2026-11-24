import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Drawer, Field, Input, Textarea, Select, Checkbox, Button, cx } from '..';
import { IconCheck, IconChevronRight } from '../icons';
import { DOC_CATEGORIES, DEFAULT_CATEGORY } from '../../../lib/documentCategories';
import { useAnalyzeUrl } from '../../../lib/onboarding';
import { clientWorkspace } from '../../../lib/api';

// Scan a website — three screens in one drawer (same design as the signup
// wizard's scan, components/orb/register/ScanWebsiteDrawer):
//   1. input    — URL + consent; Scan turns on once consent is ticked
//   2. scanning — "Reading pages…" progress bar with the pages read revealed
//   3. review   — the pages found, each with a category and an inline editor;
//                 untick what Orb shouldn't use, then Add
// Wired to the real analyze endpoint (POST /register/analyze — nothing saved);
// Add commits the chosen pages to this tenant via ws.createDocument and
// refreshes the table + readiness.

const CATEGORY_OPTIONS = DOC_CATEGORIES.map((c) => ({ value: c.id, label: c.short }));
const hostOf = (url) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || url;
const pathOf = (u, base) => { try { return new URL(u).pathname || '/'; } catch { return u?.startsWith('/') ? u : base; } };

export default function ScanWebsiteDrawer({ open, onClose }) {
  const qc = useQueryClient();
  const ws = useMemo(() => clientWorkspace(), []);
  const analyze = useAnalyzeUrl();

  const [phase, setPhase] = useState('input'); // 'input' | 'scanning' | 'review'
  const [url, setUrl] = useState('sanvifertility.in/insurance');
  const [consent, setConsent] = useState(false);
  const [found, setFound] = useState([]);
  const [read, setRead] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const [notice, setNotice] = useState('');
  const [adding, setAdding] = useState(false);
  const reveal = useRef(null);

  // Reset to the first screen each time the drawer opens.
  useEffect(() => {
    if (open) { setPhase('input'); setConsent(false); setFound([]); setRead(0); setExpanded(null); setNotice(''); setAdding(false); analyze.reset(); }
    return () => clearInterval(reveal.current);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once the scan resolves, reveal the pages one by one, then land on review.
  useEffect(() => {
    if (phase !== 'scanning' || !found.length) return undefined;
    setRead(0);
    reveal.current = setInterval(() => {
      setRead((n) => {
        if (n + 1 >= found.length) { clearInterval(reveal.current); setTimeout(() => setPhase('review'), 450); }
        return Math.min(n + 1, found.length);
      });
    }, 180);
    return () => clearInterval(reveal.current);
  }, [phase, found]);

  const startScan = async () => {
    const u = url.trim();
    setNotice('');
    setPhase('scanning');
    setFound([]);
    setRead(0);
    try {
      const data = await analyze.mutateAsync({ url: u, authorized: true });
      const pages = (data.pages || []).map((p, i) => ({
        id: i,
        title: p.title || hostOf(u),
        path: pathOf(p.sourceUrl || p.url || u, '/'),
        chars: (p.content || p.markdown || '').length,
        category: p.category || DEFAULT_CATEGORY,
        content: p.content || p.markdown || '',
        sourceUrl: p.sourceUrl || p.url || u,
        included: true
      }));
      if (!pages.length) {
        setNotice('We couldn’t read any usable pages from that URL. Try the homepage or a page with more text (About, FAQ, pricing).');
        setPhase('input');
        return;
      }
      setFound(pages);
    } catch {
      setPhase('input'); // analyze.error is shown on the input screen
    }
  };

  const toggle = (id) => setFound((ps) => ps.map((p) => (p.id === id ? { ...p, included: !p.included } : p)));
  const setCategory = (id, category) => setFound((ps) => ps.map((p) => (p.id === id ? { ...p, category } : p)));
  const setContent = (id, content) => setFound((ps) => ps.map((p) => (p.id === id ? { ...p, content, chars: content.length } : p)));
  const included = found.filter((p) => p.included);
  const totalChars = included.reduce((s, p) => s + p.chars, 0);

  const addKept = async () => {
    if (!included.length) return;
    setAdding(true);
    setNotice('');
    try {
      await Promise.all(included.map((p) => ws.createDocument({ title: p.title, content: p.content, category: p.category })));
      qc.invalidateQueries({ queryKey: ['orb-documents'] });
      qc.invalidateQueries({ queryKey: ['orb-readiness'] });
      onClose?.();
    } catch (err) {
      setNotice(err.message || 'Could not add those pages.');
    } finally {
      setAdding(false);
    }
  };

  let title = 'Scan a website';
  let description = 'Orb reads the page you paste and the pages it links to.';
  let footer = null;
  let body = null;

  if (phase === 'input') {
    const canScan = consent && url.trim();
    footer = (
      <div className="flex items-center gap-2">
        <span className="flex-1 orb-small text-orb-tertiary">Scan turns on once consent is ticked.</span>
        <Button size="md" onClick={onClose}>Cancel</Button>
        <Button size="md" variant="primary" disabled={!canScan} className={canScan ? '' : 'opacity-40'} onClick={startScan}>Scan</Button>
      </div>
    );
    body = (
      <div className="flex flex-col gap-4">
        <Field label="Website address" helper={`We’ll scan ${url.trim() || 'the page you paste'} and the pages it links to: up to 12 pages, about 30 s. About, FAQ and pricing pages are read first.`}>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="sanvifertility.in/…" />
        </Field>
        <div className="rounded-[10px] bg-orb-subtle p-3">
          <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)}>
            <span className="block orb-body-strong text-orb-ink">Sanvi Fertility &amp; IVF owns this site or may use its content to train Orb.</span>
            <span className="mt-0.5 block orb-small text-orb-tertiary">We record who agreed and when. Not ticked by default.</span>
          </Checkbox>
        </div>
        {analyze.isError && <p className="orb-small text-red-600">{analyze.error.message}</p>}
        {!analyze.isError && notice && <p className="orb-small text-red-600">{notice}</p>}
      </div>
    );
  } else if (phase === 'scanning') {
    description = url.trim();
    const waiting = !found.length; // still awaiting the API response
    const pct = waiting ? 0 : Math.round((read / found.length) * 100);
    footer = (
      <div className="flex items-center gap-2">
        <span className="flex-1 orb-small text-orb-tertiary">Insurance, pricing and FAQ pages go first.</span>
        <Button size="md" onClick={() => { clearInterval(reveal.current); setPhase('input'); }}>Cancel scan</Button>
      </div>
    );
    body = (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <p className="flex-1 orb-body-strong text-orb-ink">Reading pages…</p>
          <p className="orb-small text-orb-secondary">{waiting ? 'starting…' : `${read} of ${found.length} · ${read * 3} s`}</p>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-orb-subtle">
          {waiting
            ? <div className="h-full w-2/5 animate-pulse rounded-full bg-orb-ink" />
            : <div className="h-full rounded-full bg-orb-ink transition-all duration-200" style={{ width: `${pct}%` }} />}
        </div>
        <div className="mt-1 flex flex-col">
          {found.slice(0, read).map((p) => (
            <div key={p.id} className="flex items-center gap-2.5 border-t border-orb-hairline py-2.5">
              <span className="shrink-0 text-orb-ink"><IconCheck size={16} /></span>
              <p className="min-w-0 flex-1 truncate orb-body text-orb-ink">{p.title}</p>
              <p className="shrink-0 orb-small text-orb-tertiary">{p.path}</p>
            </div>
          ))}
        </div>
      </div>
    );
  } else {
    title = 'Review pages';
    description = `${found.length} pages found. Untick what Orb shouldn’t use. Check each category.`;
    footer = (
      <div className="flex items-center gap-2">
        <span className="flex-1 orb-small text-orb-tertiary">{included.length} pages · {totalChars.toLocaleString()} characters. Nothing is saved until you add.</span>
        <Button size="md" onClick={() => setPhase('input')} disabled={adding}>Back</Button>
        <Button size="md" variant="primary" disabled={!included.length || adding} className={!included.length || adding ? 'opacity-40' : ''} onClick={addKept}>
          {adding ? 'Adding…' : `Add ${included.length} page${included.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    );
    body = (
      <div className="flex flex-col">
        {notice && <p className="mb-2 orb-small text-red-600">{notice}</p>}
        {found.map((p) => {
          const isOpen = expanded === p.id;
          return (
            <div key={p.id} className="flex flex-col gap-2.5 border-t border-orb-hairline py-3 first:border-t-0">
              <div className="flex items-center gap-3">
                <Checkbox checked={p.included} onChange={() => toggle(p.id)} />
                <div className={cx('min-w-0 flex-1', !p.included && 'text-orb-tertiary')}>
                  <p className={cx('truncate orb-body-strong', p.included ? 'text-orb-ink' : 'text-orb-tertiary')}>{p.title}</p>
                  <p className="truncate orb-small text-orb-tertiary">{p.path} · {p.chars.toLocaleString()} characters</p>
                </div>
                <Select value={p.category} onChange={(e) => setCategory(p.id, e.target.value)} options={CATEGORY_OPTIONS} ariaLabel={`Category for ${p.title}`} className={cx('shrink-0', !p.included && 'opacity-50')} />
                <button type="button" onClick={() => setExpanded(isOpen ? null : p.id)} className="flex shrink-0 items-center gap-0.5 orb-small-medium text-orb-ink focus:outline-none">
                  {isOpen ? 'Close' : 'Edit'}
                  <span className={cx('inline-flex transition-transform', isOpen ? '-rotate-90' : 'rotate-90')}><IconChevronRight size={14} /></span>
                </button>
              </div>
              {isOpen && <Textarea value={p.content} onChange={(e) => setContent(p.id, e.target.value)} rows={4} className="font-mono text-[12.5px]" />}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <Drawer open={open} onClose={onClose} title={title} description={description} footer={footer} width={phase === 'review' ? 620 : 520}>
      {body}
    </Drawer>
  );
}
