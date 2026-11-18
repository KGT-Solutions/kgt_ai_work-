import { useState } from 'react';
import Head from 'next/head';
import OrbShell from '../../components/shell/OrbShell';
import {
  KnowledgeReadinessCard, AddKnowledgeCard, KnowledgeTable,
  ScanWebsiteDrawer, UploadFilesDrawer, WriteEntryDrawer
} from '../../components/orb/knowledge';

// Knowledge page. DATA CONTAINER: owns the page data + UI state (open drawer,
// active tab, search). Swap DATA for an API/state source later; the cards and
// drawers below never change.

const DATA = {
  readiness: {
    score: 86, max: 100, marker: 'Ready 80',
    status: { label: 'Ready', tone: 'tint' },
    checkedAt: 'Checked today, 9:58 am',
    gapsNote: '3 gaps keep it below 100',
    gaps: [
      { title: 'Insurance and TPA cover', desc: 'Asked 14× this week. No entry covers it.', actionLabel: 'Add' },
      { title: 'Sunday branch hours', desc: 'Doctors and branches lists weekdays only.', actionLabel: 'Add' },
      { title: 'Test prices', desc: 'ERA and semen analysis aren’t in Fees and packages.', actionLabel: 'Add' }
    ]
  },
  addNote: 'FAQ is read first for patient questions. Policies & pricing is trusted for money and refunds.',
  table: {
    subtitle: '57 entries · 18,940 characters',
    tabs: [
      { key: 'all', label: 'All', count: 57 },
      { key: 'website', label: 'Website pages', count: 42 },
      { key: 'files', label: 'Files', count: 6 },
      { key: 'written', label: 'Written', count: 9 }
    ],
    footerNote: 'Showing 8 of 57 · outdated first, then newest',
    entries: [
      { id: 1, kind: 'file', title: 'Fees and packages', sub: 'PDF, 2 pages · prices last changed 82 days ago', category: { label: 'Policies & pricing' }, chars: '1,240', added: '6 Oct', status: { label: 'Outdated', tone: 'yellow' } },
      { id: 2, kind: 'written', title: 'First consultation: what to bring', sub: 'Written entry', category: { label: 'FAQ' }, chars: '540', added: '2 Nov' },
      { id: 3, kind: 'website', title: 'Success rates', sub: 'sanvifertility.in/success-rates', category: { label: 'Company overview' }, chars: '760', added: '2 Nov' },
      { id: 4, kind: 'website', title: 'Egg freezing', sub: 'sanvifertility.in/egg-freezing', category: { label: 'Company overview' }, chars: '980', added: '21 Oct' },
      { id: 5, kind: 'file', title: 'Patient consent and refunds', sub: 'PDF, 4 pages', category: { label: 'Policies & pricing' }, chars: '1,630', added: '21 Oct' },
      { id: 6, kind: 'website', title: 'IVF treatment', sub: 'sanvifertility.in/ivf', category: { label: 'Company overview' }, chars: '1,420', added: '6 Oct' },
      { id: 7, kind: 'written', title: 'Doctors and branches', sub: 'Written entry', category: { label: 'Company overview' }, chars: '2,150', added: '6 Oct' },
      { id: 8, kind: 'written', title: 'Fertility tests FAQ', sub: 'Written entry', category: { label: 'FAQ' }, chars: '700', added: '6 Oct' }
    ]
  }
};

export default function KnowledgePage() {
  const [drawer, setDrawer] = useState(null); // 'scan' | 'upload' | 'write' | null
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const close = () => setDrawer(null);

  return (
    <>
      <Head><title>Knowledge · Orb</title></Head>
      <OrbShell>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-7">
          <div>
            <h1 className="orb-page-title text-orb-ink">Knowledge</h1>
            <p className="mt-1 orb-body text-orb-secondary">What Orb answers from. Every change is used from the next chat.</p>
          </div>

          <div className="grid grid-cols-1 gap-7 lg:grid-cols-[612fr_480fr]">
            <KnowledgeReadinessCard {...DATA.readiness} onFix={() => setDrawer('write')} />
            <AddKnowledgeCard note={DATA.addNote} onPick={setDrawer} />
          </div>

          <KnowledgeTable {...DATA.table} activeTab={tab} onTab={setTab} search={search} onSearch={setSearch} />
        </div>
      </OrbShell>

      {/* Add-knowledge drawers */}
      <ScanWebsiteDrawer open={drawer === 'scan'} onClose={close} />
      <UploadFilesDrawer open={drawer === 'upload'} onClose={close} />
      <WriteEntryDrawer open={drawer === 'write'} onClose={close} />
    </>
  );
}
