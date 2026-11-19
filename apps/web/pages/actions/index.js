import { useState } from 'react';
import Head from 'next/head';
import OrbShell from '../../components/shell/OrbShell';
import { Button } from '../../components/orb';
import { TemplatesCard, IntegrationsCard, ActionsTable, EditActionDrawer } from '../../components/orb/actions';

// Actions page. DATA CONTAINER: owns the page data + the on/off state; swap for
// an API/state source later (the cards never change).

const DATA = {
  templates: [
    { id: 'book', icon: 'calendar', title: 'Book a consultation', status: 'added' },
    { id: 'price', icon: 'file', title: 'Send a price guide', status: 'added' },
    { id: 'callback', icon: 'phone', title: 'Request a call back', status: 'added' },
    { id: 'emi', icon: 'link', title: 'Apply for EMI', status: 'draft' },
    { id: 'estimate', icon: 'calendar', title: 'Get a cost estimate', status: 'add' },
    { id: 'tour', icon: 'calendar', title: 'Book a clinic tour', status: 'add' }
  ],
  integrations: [
    { id: 'zoho', icon: 'crm', name: 'Zoho CRM', desc: 'Connected · leads go to Sanvi’s .in account', connected: true },
    { id: 'email', icon: 'mail', name: 'Email', desc: 'Connected · frontdesk@sanvifertility.in', connected: true },
    { id: 'gcal', icon: 'calendar', name: 'Google Calendar', desc: 'Connected · 3 branch calendars', connected: true },
    { id: 'whatsapp', icon: 'chat', name: 'WhatsApp Business', desc: 'Not connected. Until it is, “Talk to a person” goes by email.', connected: false }
  ],
  actions: [
    { id: 'a1', icon: 'calendar', title: 'Book a first consultation', triggers: '“book an appointment”, “see a doctor”, “first visit”', happens: 'Books a slot in the branch calendar. Adds the lead to Zoho CRM.', stat: '58 booked', on: true },
    { id: 'a2', icon: 'file', title: 'Send the IVF price guide', triggers: '“IVF cost”, “packages”, “how much”', happens: 'Emails the PDF to the visitor. Adds the lead to Zoho CRM.', stat: '71 sent', on: true },
    { id: 'a3', icon: 'phone', title: 'Request a call back', triggers: '“call me”, “talk on the phone”', happens: 'Emails the front desk. Adds the lead to Zoho CRM.', stat: '64 requests', on: true },
    { id: 'a4', icon: 'mail', title: 'Leave an email', badge: { label: 'Built in · live', tone: 'tint' }, triggers: 'A visitor types an email address in the chat', happens: 'Saves a lead. The visitor gets a confirmation email.', stat: '15 leads', on: true },
    { id: 'a5', icon: 'user', title: 'Talk to a person', badge: { label: 'Built in · live', tone: 'tint' }, triggers: '“talk to someone”, “human”, “call the clinic”', happens: 'Sends the chat and details to the front desk by email.', stat: '4 handoffs', on: true },
    { id: 'a6', icon: 'link', title: 'Apply for EMI', badge: { label: 'Draft · Orb won’t offer it', tone: 'neutral' }, triggers: '“EMI”, “pay in instalments”', happens: 'Opens sanvifertility.in/emi with name and phone filled in.', stat: '—', on: false }
  ],
  footerNote: 'Patient enquiries this week: 208 = 58 booked + 71 price guides + 64 call backs + 15 emails, the same 208 as on Overview. Handoffs aren’t counted as enquiries.'
};

export default function ActionsPage() {
  const [ons, setOns] = useState(() => Object.fromEntries(DATA.actions.map((a) => [a.id, a.on])));
  const actions = DATA.actions.map((a) => ({ ...a, on: ons[a.id] }));
  const toggle = (a, v) => setOns((s) => ({ ...s, [a.id]: v }));
  const [edit, setEdit] = useState(null); // the action being edited, or {} for new, or null when closed
  const openEdit = (a) => setEdit({ title: a?.title, subtitle: a ? `${a.title} · ${a.on ? 'on' : 'off'} · ${a.stat} in the last 7 days` : undefined });

  return (
    <>
      <Head><title>Actions · Orb</title></Head>
      <OrbShell>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="orb-page-title text-orb-ink">Actions</h1>
              <p className="mt-1 orb-body text-orb-secondary">What Orb can do for a visitor beyond answering. Orb only offers actions that are on.</p>
            </div>
            <Button variant="primary" size="md" onClick={() => setEdit({})}>New action</Button>
          </div>

          <div className="grid grid-cols-1 gap-7 lg:grid-cols-[630fr_480fr]">
            <TemplatesCard templates={DATA.templates} />
            <IntegrationsCard integrations={DATA.integrations} />
          </div>

          <ActionsTable subtitle="5 on, 1 draft · last 7 days" actions={actions} footerNote={DATA.footerNote} onToggle={toggle} onEdit={openEdit} />
        </div>
      </OrbShell>

      <EditActionDrawer open={!!edit} onClose={() => setEdit(null)} action={edit || {}} />
    </>
  );
}
