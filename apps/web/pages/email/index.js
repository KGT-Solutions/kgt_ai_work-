import Head from 'next/head';
import OrbShell from '../../components/shell/OrbShell';
import { EmailsCard, SenderCard, RecentlySentTable } from '../../components/orb/email';

// Email settings page. DATA CONTAINER for the "Recently sent" table; the Emails
// and Sender cards hold their own form state. Swap DATA for an API source later.

const DATA = {
  recentlySent: [
    { when: 'Tue 3 Nov, 10:47 pm', to: 'frontdesk@sanvifertility.in +1', email: 'New lead · Ananya R.', result: { label: 'Sent', tone: 'tint' } },
    { when: 'Tue 3 Nov, 6:41 pm', to: 'r•••••@gmail.com', email: 'Confirmation with a recap', result: { label: 'Sent', tone: 'tint' } },
    { when: 'Tue 3 Nov, 6:41 pm', to: 'frontdesk@sanvifertility.in +1', email: 'Visitor asked for a person · Rohit K.', result: { label: 'Sent', tone: 'tint' } },
    { when: 'Tue 3 Nov, 1:26 pm', to: 'm•••••@outlook.com', email: 'Confirmation with a recap', result: { label: 'Sent', tone: 'tint' } },
    { when: 'Tue 3 Nov, 1:26 pm', to: 'frontdesk@sanvifertility.in +1', email: 'New lead · Meera J.', result: { label: 'Sent', tone: 'tint' } },
    { when: 'Mon 2 Nov, 4:21 pm', to: 'n•••••@gmail.com', email: 'Confirmation with a recap', result: { label: 'Skipped', tone: 'neutral' }, note: 'Already emailed today' }
  ],
  recentlyFooter: 'Showing the latest 6. Visitor addresses are masked here.'
};

export default function EmailPage() {
  return (
    <>
      <Head><title>Email · Orb</title></Head>
      <OrbShell>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-7">
          <div>
            <h1 className="orb-page-title text-orb-ink">Email</h1>
            <p className="mt-1 orb-body text-orb-secondary">The emails Orb sends for you, who they come from and who gets them.</p>
          </div>

          <div className="grid grid-cols-1 items-stretch gap-7 lg:grid-cols-[612fr_480fr]">
            <EmailsCard />
            <SenderCard />
          </div>

          <RecentlySentTable rows={DATA.recentlySent} footerNote={DATA.recentlyFooter} />
        </div>
      </OrbShell>
    </>
  );
}
