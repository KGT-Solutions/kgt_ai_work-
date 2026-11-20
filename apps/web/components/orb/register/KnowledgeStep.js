import { Button, Pill } from '..';
import { OrbFormCard } from '../auth';

// Step 3 (Figma 0D): add knowledge — three ways + the entries added so far.
const WAYS = [
  { title: 'Scan a website', desc: 'We read up to 12 pages, in about 30 seconds.', action: 'Scan' },
  { title: 'Upload files', desc: 'PDF, Word, TXT or MD up to 10 MB each, or a ZIP up to 25 MB.', action: 'Choose files' },
  { title: 'Write an entry', desc: 'A title and text, for what your site doesn’t say.', action: 'Write' }
];
const ENTRIES = [
  { title: 'sanvifertility.in', sub: 'Website · 9 pages scanned', cat: 'Overview', chars: '9,820 characters' },
  { title: 'Fees and packages', sub: 'PDF · 2 pages', cat: 'Policies & pricing', chars: '1,240 characters' },
  { title: 'Doctors and branches', sub: 'Written entry', cat: 'Overview', chars: '2,150 characters' },
  { title: 'Fertility tests FAQ', sub: 'Written entry', cat: 'FAQ', chars: '700 characters' }
];

export default function KnowledgeStep({ onBack, onContinue }) {
  return (
    <OrbFormCard
      width={880}
      title="Add what Orb should know"
      subtitle="Three ways in. Use one or all of them; you can add more any time from Knowledge."
      footer={(
        <div className="flex items-center justify-between gap-3">
          <Button onClick={onBack}>Back</Button>
          <div className="flex items-center gap-3">
            <span className="orb-small text-orb-secondary">Needs at least one entry</span>
            <Button variant="primary" size="md" onClick={onContinue}>Continue</Button>
          </div>
        </div>
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {WAYS.map((w) => (
            <div key={w.title} className="flex flex-col rounded-xl border border-orb-hairline p-4">
              <p className="orb-body-strong text-orb-ink">{w.title}</p>
              <p className="mt-1 flex-1 orb-small text-orb-secondary">{w.desc}</p>
              <div className="mt-3"><Button>{w.action}</Button></div>
            </div>
          ))}
        </div>

        <div className="rounded-[10px] bg-orb-subtle px-3.5 py-3">
          <p className="orb-small-strong text-orb-ink">Each entry has a category</p>
          <p className="mt-0.5 orb-small text-orb-secondary">FAQ is read first for patient questions. Policies &amp; pricing is trusted for money questions. Overview says what you do.</p>
        </div>

        <div className="overflow-hidden rounded-xl border border-orb-hairline">
          <div className="flex items-center justify-between bg-orb-subtle px-4 py-2.5">
            <span className="orb-small text-orb-tertiary">Added so far</span>
            <span className="orb-small text-orb-tertiary">12 entries · 13,910 characters</span>
          </div>
          <ul className="divide-y divide-orb-hairline">
            {ENTRIES.map((e) => (
              <li key={e.title} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate orb-body-strong text-orb-ink">{e.title}</p>
                  <p className="truncate orb-small text-orb-secondary">{e.sub}</p>
                </div>
                <Pill tone="neutral">{e.cat}</Pill>
                <span className="w-32 shrink-0 text-right orb-small text-orb-secondary">{e.chars}</span>
                <button type="button" className="shrink-0 orb-small-medium text-orb-ink underline focus:outline-none">Edit</button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </OrbFormCard>
  );
}
