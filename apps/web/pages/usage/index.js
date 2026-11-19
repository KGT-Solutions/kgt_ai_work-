import { useState } from 'react';
import Head from 'next/head';
import OrbShell from '../../components/shell/OrbShell';
import { Select } from '../../components/orb';
import { UsageFigure, SpendByDayCard, ReusedAnswersCard, PlanCard, ByDayTable } from '../../components/orb/usage';

// Usage page. DATA CONTAINER: owns the page data + range filter. Swap DATA for an
// API/state source later; the cards never change.

const DATA = {
  rangeOptions: [{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'month', label: 'This month' }],
  figures: [
    { title: 'Spent', value: '₹13,416', caption: '↑ 4.4% on the previous 7 days' },
    { title: 'Per conversation', value: '₹4.62', caption: '2,904 conversations' },
    { title: 'Per patient enquiry', value: '₹64.50', caption: '↓ ₹8.10 · 208 enquiries' },
    { title: 'Saved by reuse', value: '₹3,240', caption: '19% off what you’d have paid' }
  ],
  spendRange: 'Wed 28 Oct to Tue 3 Nov',
  spendByDay: [
    { x: 'Wed', value: 1640 }, { x: 'Thu', value: 1790 }, { x: 'Fri', value: 1980 },
    { x: 'Sat', value: 2210 }, { x: 'Sun', value: 2120 }, { x: 'Mon', value: 1650 }, { x: 'Tue', value: 2026 }
  ],
  reusedBody: 'When a visitor asks something Orb answered in the last 24 hours, Orb reuses that answer at no cost. Changing your knowledge clears the saved answers, so nothing out of date is reused.',
  plan: { usedPct: 26, usedLabel: '26%' },
  byDay: [
    { day: 'Wed 28 Oct', conversations: '356', spent: '₹1,640', per: '₹4.61', saved: '₹390' },
    { day: 'Thu 29 Oct', conversations: '388', spent: '₹1,790', per: '₹4.61', saved: '₹430' },
    { day: 'Fri 30 Oct', conversations: '428', spent: '₹1,980', per: '₹4.63', saved: '₹480' },
    { day: 'Sat 31 Oct', conversations: '478', spent: '₹2,210', per: '₹4.62', saved: '₹540' },
    { day: 'Sun 1 Nov', conversations: '458', spent: '₹2,120', per: '₹4.63', saved: '₹520' },
    { day: 'Mon 2 Nov', conversations: '358', spent: '₹1,650', per: '₹4.61', saved: '₹400' },
    { day: 'Tue 3 Nov', conversations: '438', spent: '₹2,026', per: '₹4.63', saved: '₹480' },
    { day: 'Total', conversations: '2,904', spent: '₹13,416', per: '₹4.62', saved: '₹3,240', total: true }
  ],
  byDayFooter: 'Costs are estimates from Orb’s AI usage (38.4 million tokens this week). Your invoice is in Plan & billing.'
};

export default function UsagePage() {
  const [range, setRange] = useState('7d');

  return (
    <>
      <Head><title>Usage · Orb</title></Head>
      <OrbShell>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="orb-page-title text-orb-ink">Usage</h1>
              <p className="mt-1 orb-body text-orb-secondary">What Orb cost to run, and what it saved you.</p>
            </div>
            <Select ariaLabel="Date range" value={range} options={DATA.rangeOptions} onChange={(e) => setRange(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-7 lg:grid-cols-4">
            {DATA.figures.map((f) => <UsageFigure key={f.title} {...f} />)}
          </div>

          <div className="grid grid-cols-1 gap-7 lg:grid-cols-[612fr_480fr]">
            <SpendByDayCard range={DATA.spendRange} data={DATA.spendByDay} />
            <div className="flex flex-col gap-7">
              <ReusedAnswersCard body={DATA.reusedBody} />
              <PlanCard usedPct={DATA.plan.usedPct} usedLabel={DATA.plan.usedLabel} />
            </div>
          </div>

          <ByDayTable rows={DATA.byDay} footerNote={DATA.byDayFooter} />
        </div>
      </OrbShell>
    </>
  );
}
