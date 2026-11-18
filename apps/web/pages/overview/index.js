import { useState } from 'react';
import Head from 'next/head';
import OrbShell from '../../components/shell/OrbShell';
import { StatCard } from '../../components/orb';
import { ORB } from '../../components/orb/charts';
import {
  OverviewHeader, KnowledgeReadinessCard, NeedsYouCard, PatientEnquiriesCard,
  WhatVisitorsAskCard, VisitToBookingCard, WhenVisitorsTalkCard, OverviewFooter
} from '../../components/orb/overview';

// Overview page. This file is the DATA CONTAINER: it owns the page data and the
// control state, and maps them onto presentational cards. To wire real data
// later, replace the `DATA` constant with an API/state source (e.g. a hook that
// calls lib/api) — the card components below never change.

const HOURS = ['12 am', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12 pm', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11 pm'];
const HOUR_VALS = [31, 20, 12, 7, 5, 8, 17, 29, 48, 66, 84, 87, 80, 74, 76, 73, 69, 71, 93, 102, 120, 153, 158, 147];
const BY_HOUR = HOURS.map((x, i) => ({ x, value: HOUR_VALS[i], highlight: i >= 20 || i < 9 }));

const DATA = {
  live: 'Live · widget seen 4 min ago',
  rangeOptions: [
    { value: '7d', label: 'Last 7 days · vs previous' },
    { value: '30d', label: 'Last 30 days · vs previous' },
    { value: 'today', label: 'Today' }
  ],
  branchOptions: [
    { value: 'all', label: 'All branches' },
    { value: 'pune', label: 'Pune' },
    { value: 'mumbai', label: 'Mumbai' }
  ],
  readiness: {
    score: 86, max: 100, marker: 'Ready 80',
    status: { label: 'Ready', tone: 'tint' },
    checkedAt: 'Checked today, 9:58 am',
    gapsNote: '3 gaps keep it below 100',
    gaps: ['Insurance and TPA cover', 'Sunday branch hours', 'Test prices']
  },
  needsYou: {
    count: 3,
    items: [
      { id: 1, badge: '4', title: 'Visitors waiting for a person', sub: 'Longest 38 min', actionLabel: 'Open' },
      { id: 2, badge: '23', title: 'Questions Orb couldn’t answer', sub: 'Top: insurance cover, 14×', actionLabel: 'Add answers' },
      { id: 3, badge: '82 days', title: 'Price list out of date', sub: 'Storage fee asked 5×', actionLabel: 'Update' }
    ],
    note: { text: '3 sex-selection requests refused by law' }
  },
  enquiries: {
    value: '208',
    delta: { tone: 'tint', label: '↑ 17.5%' },
    chartData: [
      { x: 'Wed', this: 24, last: 22 }, { x: 'Thu', this: 28, last: 24 },
      { x: 'Fri', this: 30, last: 26 }, { x: 'Sat', this: 35, last: 29 },
      { x: 'Sun', this: 26, last: 27 }, { x: 'Mon', this: 22, last: 24 },
      { x: 'Tue', this: 33, last: 27 }
    ],
    chartSeries: [
      { key: 'this', label: 'This week', color: ORB.ink },
      { key: 'last', label: 'Last week', color: ORB.stroke, dashed: true }
    ],
    daySummary: ['Tue 3 Nov', 'Enquiries 32', 'Booked 8', 'Last week 27'],
    stats: [
      { label: 'Booked', value: '58', pill: { tone: 'tint', label: '+9' } },
      { label: 'Showed up', value: '41' },
      { label: 'Per 1,000 visitors', value: '11.2', pill: { tone: 'tint', label: '2.1×' } }
    ]
  },
  whatAsk: [
    { label: 'IVF cost and packages', pct: 24 },
    { label: 'Success rates', pct: 12 },
    { label: 'AMH and fertility tests', pct: 9 },
    { label: 'Doctor availability', pct: 9 },
    { label: 'EMI and insurance', pct: 8, pill: { tone: 'tint', label: '63% answered' } },
    { label: 'Egg freezing', pct: 6 }
  ],
  funnel: {
    headlinePct: '0.3%',
    headlineNote: 'of site visitors booked a consultation',
    steps: [
      { label: 'Site visitors', value: '18,642' },
      { label: 'Opened Orb', value: '2,317', barPct: 12, barNote: '12% of visitors' },
      { label: 'Took a first action', value: '1,486', barPct: 64, barNote: '64% of openers' },
      { label: 'Patient enquiries', value: '208', pill: { tone: 'tint', label: 'Biggest drop in Orb' }, barPct: 14, barNote: '14% of first actions' },
      { label: 'Booked', value: '58', barPct: 28, barNote: '28% of enquiries' }
    ],
    footnote: 'Bar = share who continued from the step above'
  },
  whenTalk: { pct: '42%', note: 'after hours, 8 pm–9 am', barData: BY_HOUR, busiest: '9–11 pm', quietest: '4–5 am' },
  footer: { conversations: '2,904', perConversation: '₹4.62 per conversation', planUsedPct: 26, planLabel: '26%', dataNote: 'Data stored in India' }
};

export default function OverviewPage() {
  const [range, setRange] = useState('7d');
  const [branch, setBranch] = useState('all');

  return (
    <>
      <Head><title>Overview · Orb</title></Head>
      <OrbShell>
        {/* Overview content caps at 1200px (Orb §7 main shell) and centres. */}
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-7">
          <OverviewHeader
            live={DATA.live}
            rangeValue={range} rangeOptions={DATA.rangeOptions} onRangeChange={(e) => setRange(e.target.value)}
            branchValue={branch} branchOptions={DATA.branchOptions} onBranchChange={(e) => setBranch(e.target.value)}
          />

          {/* Row 1 */}
          <div className="grid grid-cols-1 gap-7 lg:grid-cols-[612fr_480fr]">
            <KnowledgeReadinessCard {...DATA.readiness} />
            <NeedsYouCard {...DATA.needsYou} />
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-1 gap-7 lg:grid-cols-[612fr_480fr]">
            <PatientEnquiriesCard {...DATA.enquiries} />
            <div className="flex flex-col gap-7">
              <div className="grid grid-cols-2 gap-7">
                <StatCard title="Answered by Orb" value="87%" delta={{ tone: 'tint', label: '+2 pts' }} />
                <StatCard title="Cost per enquiry" value="₹65" delta={{ tone: 'tint', label: '−₹8' }} />
              </div>
              <WhatVisitorsAskCard items={DATA.whatAsk} />
            </div>
          </div>

          {/* Row 3 */}
          <div className="grid grid-cols-1 gap-7 lg:grid-cols-[612fr_480fr]">
            <VisitToBookingCard {...DATA.funnel} />
            <WhenVisitorsTalkCard {...DATA.whenTalk} />
          </div>

          <OverviewFooter {...DATA.footer} />
        </div>
      </OrbShell>
    </>
  );
}
