import { useState } from 'react';
import Head from 'next/head';
import OrbShell from '../../components/shell/OrbShell';
import { Chip, Select, Segmented } from '../../components/orb';
import { ConversationList, ConversationDetail, RealConversations } from '../../components/orb/conversations';

const BOT_OPTIONS = [{ value: 'all', label: 'All bots' }, { value: 'support', label: 'Support' }, { value: 'sales', label: 'Sales' }];

// Conversations page. DATA CONTAINER: owns the list/detail data + UI state
// (filter tab, selected conversation). Swap DATA for an API/state source later.

const DATA = {
  tabs: [
    { key: 'all', label: 'All', count: '2,904' },
    { key: 'after', label: 'After hours', count: '1,208' },
    { key: 'details', label: 'Left details', count: '208' },
    { key: 'ticket', label: 'Became a ticket', count: '65' },
    { key: 'person', label: 'Asked for a person', count: '4' }
  ],
  rangeOptions: [{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'today', label: 'Today' }],
  branchOptions: [{ value: 'all', label: 'All branches' }, { value: 'kharadi', label: 'Kharadi' }, { value: 'baner', label: 'Baner' }],
  listHeader: '2,904 conversations · newest first',
  listFooter: 'Showing 8 of 2,904 · today, 3 Nov',
  list: [
    { id: 1, name: 'Ananya R.', time: '10:42 pm', text: 'IVF ka total kharcha kitna hai? Medicines included?', meta: 'Hinglish · /ivf-cost', pills: [{ label: 'Booked', tone: 'blue' }, { label: 'Ticket', tone: 'yellow' }] },
    { id: 2, name: 'Visitor', time: '9:15 pm', text: 'Do you accept Star Health insurance for IVF?', meta: 'English · /insurance', pills: [{ label: 'Ticket', tone: 'yellow' }] },
    { id: 3, name: 'Visitor', time: '8:02 pm', text: 'What is an AMH test and do I need one?', meta: 'English · /fertility-tests', pills: [] },
    { id: 4, name: 'Rohit K.', time: '6:40 pm', text: 'Can I talk to a doctor right now?', meta: 'English · /contact', pills: [{ label: 'Person', tone: 'yellow' }] },
    { id: 5, name: 'Visitor', time: '4:11 pm', text: 'Egg freezing ki storage fee kitni hai?', meta: 'Hinglish · /egg-freezing', pills: [{ label: 'Ticket', tone: 'yellow' }] },
    { id: 6, name: 'Meera J.', time: '1:25 pm', text: 'Which doctors work at Kharadi?', meta: 'English · /branches/kharadi', pills: [{ label: 'Lead', tone: 'neutral' }] },
    { id: 7, name: 'Visitor', time: '12:10 pm', text: 'Sunday ko Baner branch khula hai?', meta: 'Hinglish · /contact', pills: [{ label: 'Ticket', tone: 'yellow' }] },
    { id: 8, name: 'Sneha P.', time: '11:03 am', text: 'How do I book a first consultation?', meta: 'English · /', pills: [{ label: 'Booked', tone: 'blue' }] }
  ],
  detail: {
    name: 'Ananya R.',
    pills: [{ label: 'Booked', tone: 'blue' }, { label: 'Ticket', tone: 'yellow' }],
    meta: 'Tue 3 Nov, 10:42 pm · 7 min · Hinglish · started on sanvifertility.in/ivf-cost · cost ₹5.10',
    summaryMeta: 'written 2 min after the chat ended',
    summary: 'Asked what one IVF cycle costs and whether Star Health covers it. Orb gave the price from Fees and packages. Insurance isn’t in your knowledge, so a ticket was made. Booked a first consultation at Kharadi for Thu 5 Nov, 10 am.',
    messages: [
      { role: 'visitor', text: 'IVF ka total kharcha kitna hai? Medicines included?', time: '10:42 pm' },
      { role: 'orb', text: 'One IVF cycle at Sanvi starts at ₹1,65,000, including medicines up to ₹40,000. Your doctor confirms the final plan at the first consultation.', source: 'From Fees and packages · Policies & pricing', correct: true },
      { role: 'visitor', text: 'Star Health cover karta hai kya?', time: '10:44 pm' },
      { role: 'orb', text: 'I don’t have Sanvi’s insurance details yet. I can pass your question to the Sanvi team with your number so they can confirm.', boxes: [{ icon: 'ticket', text: 'Not in your knowledge · Ticket made: Insurance and TPA cover' }] },
      { role: 'visitor', text: 'Theek hai. Kharadi mein first consultation book karna hai.', time: '10:46 pm' },
      { role: 'orb', text: 'You’re booked at Sanvi Kharadi on Thu 5 Nov, 10 am. The front desk will call to confirm within 2 hours.', boxes: [{ icon: 'action', text: 'Action · Book a first consultation · Booked' }, { icon: 'lead', text: 'Lead saved: Ananya R., +91 98•••••210' }] }
    ],
    footer: 'Phone numbers are masked here. Full details are in Leads & bookings, visible to your team only.'
  }
};

export default function ConversationsPage() {
  const [mode, setMode] = useState('dummy'); // 'dummy' = mock design · 'real' = Sessions API
  const [tab, setTab] = useState('all');
  const [range, setRange] = useState('7d');
  const [branch, setBranch] = useState('all');
  const [botFilter, setBotFilter] = useState('all'); // real mode — the one API-backed filter
  const [selected, setSelected] = useState(DATA.list[0].id);

  return (
    <>
      <Head><title>Conversations · Orb</title></Head>
      <OrbShell>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="orb-page-title text-orb-ink">Conversations</h1>
                <Segmented ariaLabel="Data source" value={mode} onChange={setMode}
                  options={[{ value: 'dummy', label: 'Dummy' }, { value: 'real', label: 'Real' }]} />
              </div>
              <p className="mt-1 orb-body text-orb-secondary">Every chat visitors had with Orb. Read the transcript, see where each answer came from, fix a wrong one.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {mode === 'real' && (
                <Select ariaLabel="Bot" value={botFilter} options={BOT_OPTIONS} onChange={(e) => setBotFilter(e.target.value)} />
              )}
              <Select ariaLabel="Date range" value={range} options={DATA.rangeOptions} onChange={(e) => setRange(e.target.value)} />
              <Select ariaLabel="Branch" value={branch} options={DATA.branchOptions} onChange={(e) => setBranch(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {DATA.tabs.map((t) => (
              <Chip key={t.key} selected={tab === t.key} count={t.count} onClick={() => setTab(t.key)}>{t.label}</Chip>
            ))}
          </div>

          {mode === 'real' ? (
            <RealConversations botType={botFilter} />
          ) : (
            <div className="grid min-h-[560px] grid-cols-1 overflow-hidden rounded-2xl border border-orb-hairline bg-orb-white lg:h-[calc(100vh-232px)] lg:grid-cols-[380px_1fr]">
              <ConversationList
                header={DATA.listHeader}
                items={DATA.list}
                selectedId={selected}
                onSelect={setSelected}
                footerNote={DATA.listFooter}
                className="border-b border-orb-hairline lg:border-b-0 lg:border-r"
              />
              <ConversationDetail convo={DATA.detail} />
            </div>
          )}
        </div>
      </OrbShell>
    </>
  );
}
