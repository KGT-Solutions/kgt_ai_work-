import { useMemo, useState } from 'react';
import Head from 'next/head';
import { useQuery } from '@tanstack/react-query';
import OrbShell from '../../components/shell/OrbShell';
import {
  KnowledgeReadinessCard, AddKnowledgeCard, KnowledgeTable,
  ScanWebsiteDrawer, UploadFilesDrawer, WriteEntryDrawer
} from '../../components/orb/knowledge';
import { clientWorkspace } from '../../lib/api';
import { categoryLabel } from '../../lib/documentCategories';
import { botScopeLabel } from '../../lib/botScopes';

// Knowledge page. The table ("Knowledge Orb can use") is wired to the real
// workspace API (ws.listDocuments); the readiness and add cards are still mock.

// Category → Orb pill tone.
const CAT_TONE = { CORE_OVERVIEW: 'neutral', FAQ: 'blue', CUSTOM_POLICY: 'yellow' };
const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { return ''; } };
const fmtDateTime = (iso) => { try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
// Readiness score → status pill. Bands mirror the API's levels (≥80 ready,
// 50–79 moderate, <50 not ready); yellow = needs your attention.
const readinessLevel = (score) =>
  score >= 80 ? { label: 'Ready', tone: 'tint' }
    : score >= 50 ? { label: 'Moderate', tone: 'yellow' }
      : { label: 'Not ready', tone: 'yellow' };
// Map one API document → a table row.
const toRow = (d) => ({
  id: d.id,
  title: d.title,
  sub: d.sourceUrl || 'Written entry',
  category: { label: categoryLabel(d.category), tone: CAT_TONE[d.category] || 'neutral' },
  // "Used by" = bot scope; shown only when it's not the default AUTO (like the legacy list).
  usedBy: d.botScope && d.botScope !== 'AUTO' ? `${botScopeLabel(d.botScope)} bot${d.botScope === 'BOTH' ? 's' : ''}` : null,
  chars: (d.content?.length || 0).toLocaleString(),
  added: fmtDate(d.createdAt),
  content: d.content || '',
  hasUrl: !!d.sourceUrl
});

const DATA = {
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
  const [readinessBot, setReadinessBot] = useState('support'); // readiness card bot switcher
  const close = () => setDrawer(null);

  // Real documents for the table.
  const ws = useMemo(() => clientWorkspace(), []);
  const { data: docs = [], isLoading, error } = useQuery({ queryKey: ['orb-documents'], queryFn: () => ws.listDocuments() });

  // Readiness report (per-bot training). getReadiness is a cheap read of the
  // saved report (no AI call); poll while a background audit is running.
  const { data: readiness, isLoading: readinessLoading, error: readinessError } = useQuery({
    queryKey: ['orb-readiness'],
    queryFn: () => ws.getReadiness(),
    refetchInterval: (query) => (query.state.data?.running ? 5000 : false)
  });
  const report = readiness?.report || null;
  const botReport = report?.bots?.[readinessBot] || null;
  const gapList = (botReport?.criticalGaps || []).map((g) => ({ title: g, actionLabel: 'Add' }));
  const gapCount = gapList.length;
  const readinessStatus = botReport ? readinessLevel(botReport.score) : null;
  const readinessNote =
    readinessLoading ? 'Checking readiness…'
      : readinessError ? (readinessError.message || 'Could not load readiness')
        : !botReport ? 'Run a training check to see readiness.'
          : gapCount === 0 ? 'Nothing critical is missing.'
            : `${gapCount} gap${gapCount === 1 ? '' : 's'} keep it below 100`;
  const readinessCheckedAt =
    readiness?.running ? 'Checking now…'
      : report?.auditedAt ? `Checked ${fmtDateTime(report.auditedAt)}`
        : 'Not checked yet';

  const rows = docs.map(toRow);
  const nonWebsite = rows.filter((r) => !r.hasUrl).length;
  // Website is derivable (sourceUrl); Files vs Written can't be told apart from
  // the data, so both tabs show the non-website set (mock) and share an icon.
  const tabs = [
    { key: 'all', label: 'All', count: rows.length },
    { key: 'website', label: 'Website pages', count: rows.filter((r) => r.hasUrl).length },
    { key: 'files', label: 'Files', count: nonWebsite },
    { key: 'written', label: 'Written', count: nonWebsite }
  ];
  const q = search.trim().toLowerCase();
  const visible = rows
    .filter((r) => (tab === 'all' ? true : tab === 'website' ? r.hasUrl : !r.hasUrl))
    .filter((r) => !q || r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q));
  const totalChars = docs.reduce((s, d) => s + (d.content?.length || 0), 0);
  const tableSubtitle = `${rows.length} entries · ${totalChars.toLocaleString()} characters`;

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
            <KnowledgeReadinessCard
              score={botReport?.score ?? 0}
              marker="Ready 80"
              status={readinessStatus}
              checkedAt={readinessCheckedAt}
              gapsNote={readinessNote}
              gaps={gapList}
              bot={readinessBot}
              onBot={setReadinessBot}
              onFix={() => setDrawer('write')}
            />
            <AddKnowledgeCard note={DATA.addNote} onPick={setDrawer} />
          </div>

          <KnowledgeTable
            subtitle={tableSubtitle}
            tabs={tabs}
            activeTab={tab}
            onTab={setTab}
            search={search}
            onSearch={setSearch}
            entries={visible}
            loading={isLoading}
            error={error?.message}
            footerNote={`Showing ${visible.length} of ${rows.length}`}
          />
        </div>
      </OrbShell>

      {/* Add-knowledge drawers */}
      <ScanWebsiteDrawer open={drawer === 'scan'} onClose={close} />
      <UploadFilesDrawer open={drawer === 'upload'} onClose={close} />
      <WriteEntryDrawer open={drawer === 'write'} onClose={close} />
    </>
  );
}
