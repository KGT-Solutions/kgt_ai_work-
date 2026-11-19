import { useState } from 'react';
import Head from 'next/head';
import OrbShell from '../../components/shell/OrbShell';
import { Chip, Select, IconLock } from '../../components/orb';
import { LeadsTable, LeadDrawer } from '../../components/orb/leads';

// Leads & bookings page. DATA CONTAINER: owns the table data + UI state (tab,
// status filter, open lead). Swap DATA for an API/state source later.

const DATA = {
  rangeOptions: [{ value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: 'today', label: 'Today' }],
  branchOptions: [{ value: 'all', label: 'All branches' }, { value: 'kharadi', label: 'Kharadi' }, { value: 'baner', label: 'Baner' }],
  tabs: [
    { key: 'all', label: 'All', count: '211' }, { key: 'booked', label: 'Booked', count: '58' },
    { key: 'guide', label: 'Price guide', count: '71' }, { key: 'callback', label: 'Call back', count: '64' },
    { key: 'email', label: 'Email', count: '15' }, { key: 'person', label: 'Asked for a person', count: '3' }
  ],
  statusOptions: [
    { value: 'all', label: 'All statuses' }, { value: 'new', label: 'New' }, { value: 'contacted', label: 'Contacted' },
    { value: 'booked', label: 'Booked' }, { value: 'showed', label: 'Showed up' }, { value: 'guide', label: 'Guide sent' }
  ],
  subtitle: '211 people · newest first',
  footerNote: 'Showing 10 of 211',
  pageFooter: 'Full contact details show on this page only, and only to your team. Everywhere else they’re masked.',
  leads: [
    { id: 1, name: 'Ananya R.', sub: 'Hinglish · /ivf-cost', phone: '+91 98765 43210', email: 'No email given', askedFor: 'Book a first consultation', askedSub: 'Kharadi · Thu 5 Nov, 10 am', when: 'Tue 3 Nov', whenTime: '10:42 pm', status: { label: 'Booked', tone: 'blue' } },
    { id: 2, name: 'Kavita M.', sub: 'English · /ivf', phone: '+91 90110 27356', email: 'kavita.m@gmail.com', askedFor: 'Asked for a person', askedSub: 'About a failed IVF cycle', when: 'Tue 3 Nov', whenTime: '7:06 pm', status: { label: 'New', tone: 'yellow' } },
    { id: 3, name: 'Visitor', sub: 'Hinglish · /donor-programme', phone: '+91 97640 55218', email: 'No email given', askedFor: 'Asked for a person', askedSub: 'About donor eggs', when: 'Tue 3 Nov', whenTime: '6:57 pm', status: { label: 'New', tone: 'yellow' } },
    { id: 4, name: 'Rohit K.', sub: 'English · /contact', phone: '+91 99203 45417', email: 'rohitk84@gmail.com', askedFor: 'Asked for a person', askedSub: 'Wants a doctor to call after 6 pm', when: 'Tue 3 Nov', whenTime: '6:40 pm', status: { label: 'New', tone: 'yellow' } },
    { id: 5, name: 'Meera J.', sub: 'English · /branches/kharadi', phone: 'meera.joshi@outlook.com', email: 'No phone given', askedFor: 'Left an email', askedSub: 'Asked which doctors work at Kharadi', when: 'Tue 3 Nov', whenTime: '1:25 pm', status: { label: 'New', tone: 'yellow' } },
    { id: 6, name: 'Sneha P.', sub: 'English · /', phone: '+91 97300 11862', email: 'sneha.p@gmail.com', askedFor: 'Book a first consultation', askedSub: 'Baner · Fri 6 Nov, 4 pm', when: 'Tue 3 Nov', whenTime: '11:03 am', status: { label: 'Booked', tone: 'blue' } },
    { id: 7, name: 'Neha S.', sub: 'English · /insurance', phone: 'neha.s@gmail.com', email: 'No phone given', askedFor: 'Left an email', askedSub: 'Asked about cashless TPA at Baner', when: 'Mon 2 Nov', whenTime: '4:20 pm', status: { label: 'Contacted', tone: 'neutral' } },
    { id: 8, name: 'Priya D.', sub: 'English · /ivf-cost', phone: 'priya.desai@yahoo.com', email: 'No phone given', askedFor: 'Send the IVF price guide', askedSub: 'Orb emailed the PDF', when: 'Mon 2 Nov', whenTime: '2:05 pm', status: { label: 'Guide sent', tone: 'tint' } },
    { id: 9, name: 'Deepa N.', sub: 'Marathi · /iui', phone: '+91 98220 60471', email: 'No email given', askedFor: 'Book a first consultation', askedSub: 'Wakad · Mon 2 Nov, 5 pm', when: 'Sun 1 Nov', whenTime: '8:15 pm', status: { label: 'Showed up', tone: 'tint' } },
    { id: 10, name: 'Farhan A.', sub: 'English · /insurance', phone: '+91 88012 34509', email: 'No email given', askedFor: 'Request a call back', askedSub: 'About insurance cover', when: 'Sat 31 Oct', whenTime: '9:30 pm', status: { label: 'Contacted', tone: 'neutral' } }
  ],
  leadDetail: {
    name: 'Ananya R.', status: 'booked', statusPill: { label: 'Booked', tone: 'blue' },
    subtitle: 'Booked a first consultation · Tue 3 Nov, 10:42 pm · Hinglish',
    contact: { phone: '+91 98765 43210', email: 'Not given', language: 'Hinglish' },
    booking: { branch: 'Kharadi', dayTime: 'Thu 5 Nov, 10 am', confirmation: 'Front desk calls within 2 hours' },
    summaryMeta: 'written 2 min after the chat ended',
    summary: 'Asked what one IVF cycle costs and whether Star Health covers it. Orb gave the price from Fees and packages. Insurance isn’t in your knowledge, so a ticket was made. Booked a first consultation at Kharadi for Thu 5 Nov, 10 am.',
    whereWent: [{ label: 'Zoho CRM', value: 'Lead added · Tue 3 Nov, 10:47 pm', action: 'Open in Zoho' }, { label: 'Branch calendar', value: 'Slot booked' }, { label: 'Recap email', value: 'Not sent · no email given' }],
    fromChat: [{ label: 'Conversation', value: 'Tue 3 Nov, 10:42 pm · 7 min', action: 'Open' }, { label: 'Ticket', value: 'Insurance and TPA cover', action: 'Open' }]
  }
};

export default function LeadsPage() {
  const [tab, setTab] = useState('all');
  const [range, setRange] = useState('7d');
  const [branch, setBranch] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [open, setOpen] = useState(false);

  return (
    <>
      <Head><title>Leads & bookings · Orb</title></Head>
      <OrbShell>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="orb-page-title text-orb-ink">Leads &amp; bookings</h1>
              <p className="mt-1 orb-body text-orb-secondary">Everyone who left their details with Orb, and what they asked for.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Select ariaLabel="Date range" value={range} options={DATA.rangeOptions} onChange={(e) => setRange(e.target.value)} />
              <Select ariaLabel="Branch" value={branch} options={DATA.branchOptions} onChange={(e) => setBranch(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {DATA.tabs.map((t) => <Chip key={t.key} selected={tab === t.key} count={t.count} onClick={() => setTab(t.key)}>{t.label}</Chip>)}
          </div>

          <LeadsTable
            subtitle={DATA.subtitle}
            statusValue={statusFilter}
            statusOptions={DATA.statusOptions}
            onStatus={(e) => setStatusFilter(e.target.value)}
            leads={DATA.leads}
            footerNote={DATA.footerNote}
            onOpen={() => setOpen(true)}
          />

          <div className="flex items-center gap-2 px-1">
            <span className="text-orb-tertiary"><IconLock size={14} /></span>
            <span className="orb-small text-orb-secondary">{DATA.pageFooter}</span>
          </div>
        </div>
      </OrbShell>

      <LeadDrawer open={open} onClose={() => setOpen(false)} lead={DATA.leadDetail} />
    </>
  );
}
