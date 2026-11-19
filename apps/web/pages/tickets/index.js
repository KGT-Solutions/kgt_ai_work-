import { useState } from 'react';
import Head from 'next/head';
import OrbShell from '../../components/shell/OrbShell';
import { Chip, Select } from '../../components/orb';
import { TicketList, UnansweredDetail, PersonDetail } from '../../components/orb/tickets';

// Tickets page. DATA CONTAINER: owns both tabs' data + UI state (active tab,
// selected row). Swap DATA for an API/state source later.

const DATA = {
  rangeOptions: [{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'today', label: 'Today' }],
  branchOptions: [{ value: 'all', label: 'All branches' }, { value: 'kharadi', label: 'Kharadi' }, { value: 'baner', label: 'Baner' }],
  unanswered: {
    listHeader: '23 questions · 61 tickets · most asked first',
    list: [
      { id: 'u1', title: 'Insurance and TPA cover', right: '14×', text: '“Do you accept Star Health insurance for IVF?” and 13 more', meta: 'Last asked Tue 10:42 pm · 5 left details', pill: { label: 'Readiness gap', tone: 'yellow' } },
      { id: 'u2', title: 'Sunday branch hours', right: '9×', text: '“Sunday ko Baner branch khula hai?” and 8 more', meta: 'Last asked Mon 2 Nov · 2 left details', pill: { label: 'Readiness gap', tone: 'yellow' } },
      { id: 'u3', title: 'Test prices', right: '7×', text: '“How much is an AMH test?” and 6 more', meta: 'Last asked Mon 2 Nov · 1 left details', pill: { label: 'Readiness gap', tone: 'yellow' } },
      { id: 'u4', title: 'Egg freezing storage fee', right: '5×', text: '“Egg freezing ki storage fee kitni hai?” and 4 more', meta: 'Fees and packages is 82 days old', pill: { label: 'Outdated', tone: 'yellow' } },
      { id: 'u5', title: 'EMI and payment plans', right: '4×', text: '“Can I pay for IVF in EMIs?” and 3 more', meta: 'Last asked Sun 1 Nov · 1 left details' },
      { id: 'u6', title: 'Donor egg programme', right: '3×', text: '“Do you have a donor egg programme?” and 2 more', meta: 'Last asked Sat 31 Oct' },
      { id: 'u7', title: 'Parking at Kharadi', right: '2×', text: '“Is there parking at the Kharadi branch?” and 1 more', meta: 'Last asked Sat 31 Oct' },
      { id: 'u8', title: '16 more questions', right: '17×', text: 'Each asked once or twice', meta: 'Oldest Sat 31 Oct' }
    ],
    detail: {
      title: 'Insurance and TPA cover', pill: { label: 'Readiness gap', tone: 'yellow' },
      meta: '14 tickets in the last 7 days · first asked Fri 30 Oct · last asked Tue 3 Nov, 10:42 pm',
      seeAll: 'See all 14',
      asked: [
        { q: '“Star Health cover karta hai kya?”', meta: 'Hinglish · Ananya R. · Tue 3 Nov, 10:42 pm' },
        { q: '“Do you accept Star Health insurance for IVF?”', meta: 'English · Visitor · Tue 3 Nov, 9:15 pm' },
        { q: '“Is cashless TPA available at the Baner branch?”', meta: 'English · Neha S. · Mon 2 Nov' },
        { q: '“Mediclaim se IVF ka kharcha milta hai?”', meta: 'Hinglish · Visitor · Sun 1 Nov' }
      ],
      orbReply: 'I don’t have Sanvi’s insurance details yet. I can pass your question to the Sanvi team with your number so they can confirm.',
      orbNote: 'Orb didn’t guess. It offered to pass the question on, asked for contact details and made this ticket.',
      waitingLabel: 'Waiting to hear from you · 5 left details',
      contacts: [
        { name: 'Ananya R.', contact: '+91 98•••••210', date: 'Tue 3 Nov' },
        { name: 'Visitor', contact: '+91 97•••••034', date: 'Mon 2 Nov' },
        { name: 'Neha S.', contact: 'n•••••@gmail.com', date: 'Mon 2 Nov' },
        { name: 'Visitor', contact: '+91 90•••••771', date: 'Sun 1 Nov' },
        { name: 'Farhan A.', contact: '+91 88•••••509', date: 'Sat 31 Oct' }
      ],
      answerText: 'Yes. We accept cashless claims from Star Health and other insurers through their TPA, if your policy covers fertility treatment. Bring your policy card to your first visit and our billing desk will check your cover.',
      answerNote: 'Saving adds a written entry to Knowledge and closes these 14 tickets.'
    }
  },
  person: {
    listHeader: '4 waiting · longest first',
    listFooter: 'None marked as contacted in the last 7 days.',
    list: [
      { id: 'p1', title: 'Rohit K.', right: 'Waiting 38 min', text: 'Can I talk to a doctor right now?', meta: 'English · /contact', pill: { label: 'Left details', tone: 'tint' } },
      { id: 'p2', title: 'Visitor', right: 'Waiting 21 min', text: 'Mujhe donor eggs ke baare mein kisi se baat karni hai', meta: 'Hinglish · /donor-programme', pill: { label: 'Left details', tone: 'tint' } },
      { id: 'p3', title: 'Kavita M.', right: 'Waiting 12 min', text: 'I want to speak to someone about my failed IVF cycle', meta: 'English · /ivf', pill: { label: 'Left details', tone: 'tint' } },
      { id: 'p4', title: 'Visitor', right: 'Waiting 4 min', text: 'Receptionist se baat karwa do', meta: 'Hinglish · /contact', pill: { label: 'No contact left', tone: 'neutral' } }
    ],
    detail: {
      name: 'Rohit K.', waiting: 'Waiting 38 min',
      meta: 'Asked at 6:40 pm · English · started on sanvifertility.in/contact',
      reach: { phone: '+91 99•••••417', email: 'rohit•••@gmail.com', prefers: 'A call after 6 pm, said in the chat' },
      summaryMeta: 'written 2 min after the chat ended',
      summary: 'Had an IVF cycle at another clinic that didn’t work. Wants to talk to a doctor before moving to Sanvi, and asked which doctors work at Kharadi. Orb listed them from your knowledge and took his number and email.',
      messages: [
        { role: 'visitor', text: 'Can I talk to a doctor right now?', time: '6:40 pm' },
        { role: 'orb', text: 'Of course. What’s the best number or email for the Sanvi team to reach you?', boxes: [{ icon: 'ticket', text: 'Asked for a person · Ticket made' }] },
        { role: 'visitor', text: 'rohit•••@gmail.com, 99•••••417. Call after 6 please', time: '6:41 pm' },
        { role: 'orb', text: 'Thanks, Rohit. The Sanvi team will be in touch. I’ve emailed you a recap of what we talked about.', boxes: [{ icon: 'lead', text: 'Lead saved: Rohit K. · Recap email sent' }] }
      ],
      footer: 'Phone numbers are masked here. Full details are in Leads & bookings, visible to your team only.'
    }
  }
};

export default function TicketsPage() {
  const [tab, setTab] = useState('unanswered');
  const [range, setRange] = useState('7d');
  const [branch, setBranch] = useState('all');
  const [selU, setSelU] = useState(DATA.unanswered.list[0].id);
  const [selP, setSelP] = useState(DATA.person.list[0].id);

  return (
    <>
      <Head><title>Tickets · Orb</title></Head>
      <OrbShell>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="orb-page-title text-orb-ink">Tickets</h1>
              <p className="mt-1 orb-body text-orb-secondary">Questions Orb couldn’t answer, grouped by meaning, and visitors who asked for a person.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select ariaLabel="Date range" value={range} options={DATA.rangeOptions} onChange={(e) => setRange(e.target.value)} />
              <Select ariaLabel="Branch" value={branch} options={DATA.branchOptions} onChange={(e) => setBranch(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Chip selected={tab === 'unanswered'} count="23" onClick={() => setTab('unanswered')}>Unanswered</Chip>
            <Chip selected={tab === 'person'} count="4" onClick={() => setTab('person')}>Asked for a person</Chip>
          </div>

          <div className="grid min-h-[600px] grid-cols-1 overflow-hidden rounded-2xl border border-orb-hairline bg-orb-white lg:h-[calc(100vh-232px)] lg:grid-cols-[400px_1fr]">
            {tab === 'unanswered' ? (
              <>
                <TicketList header={DATA.unanswered.listHeader} items={DATA.unanswered.list} selectedId={selU} onSelect={setSelU} className="border-b border-orb-hairline lg:border-b-0 lg:border-r" />
                <UnansweredDetail ticket={DATA.unanswered.detail} />
              </>
            ) : (
              <>
                <TicketList header={DATA.person.listHeader} items={DATA.person.list} selectedId={selP} onSelect={setSelP} footerNote={DATA.person.listFooter} className="border-b border-orb-hairline lg:border-b-0 lg:border-r" />
                <PersonDetail person={DATA.person.detail} />
              </>
            )}
          </div>
        </div>
      </OrbShell>
    </>
  );
}
