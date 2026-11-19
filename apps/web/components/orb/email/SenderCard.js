import { Pill, Button, Field, Input, Select } from '..';

// "Sender" — who emails come from + SMTP settings. Inputs use defaultValue so the
// form is editable without wiring (swap to controlled state when saving is added).
export default function SenderCard() {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-orb-hairline bg-orb-white">
      <div className="flex items-start justify-between gap-3 border-b border-orb-hairline px-7 py-6">
        <div>
          <p className="orb-card-title text-orb-ink">Sender</p>
          <p className="mt-0.5 orb-small text-orb-secondary">Who your emails come from.</p>
        </div>
        <Pill tone="tint">Connected</Pill>
      </div>

      <div className="flex flex-1 flex-col gap-5 px-7 py-6">
        <Field label="Send from">
          <Select fullWidth size="md" defaultValue="own" options={[{ value: 'own', label: 'Your own address' }, { value: 'orb', label: 'Orb’s shared address' }]} ariaLabel="Send from" />
        </Field>
        <Field label="From name"><Input defaultValue="Sanvi Fertility & IVF" /></Field>
        <Field label="From address" helper="Must be the mailbox you sign in with below."><Input defaultValue="care@sanvifertility.in" /></Field>
        <div className="flex gap-3">
          <Field label="Mail server (SMTP)" className="flex-1"><Input defaultValue="smtp.gmail.com" /></Field>
          <Field label="Port" className="w-24"><Input defaultValue="587" /></Field>
        </div>
        <Field label="Username"><Input defaultValue="care@sanvifertility.in" /></Field>
        <Field label="Password" helper="Use an app password if your mailbox has two-step sign-in."><Input type="password" defaultValue="supersecretvalue" /></Field>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-orb-hairline px-7 py-4">
        <span className="orb-small text-orb-secondary">Last test delivered Tue 3 Nov, 9:12 am</span>
        <Button>Send a test email</Button>
      </div>
    </div>
  );
}
