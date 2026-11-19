import Head from 'next/head';
import OrbShell from '../../components/shell/OrbShell';
import { InstallStatusCard, SnippetsCard, WherePasteCard, KeysCard } from '../../components/orb/install';

// Install page. DATA CONTAINER: owns the page data; swap for an API/state source
// later — the cards below never change.

const SNIPPET = (bot) => `<script src="https://ai.kgt.solutions/widgets/tenant-chat-widget.js"
  data-tenant-id="sanvi-fertility-a1b2c3"
  data-api-key="tk_3f9a1c•••••••••••••"
  data-bot="${bot}" defer></script>`;

const DATA = {
  status: {
    statusLabel: 'Live',
    note: 'Widget seen 4 min ago on sanvifertility.in/ivf-cost.',
    steps: [
      { title: 'Copy a snippet', sub: 'Key made 6 Oct' },
      { title: 'Paste it on your site', sub: 'Widget seen 4 min ago' },
      { title: 'First visitor chat', sub: '12 Oct, 10:41 am. Orb is Live.' }
    ]
  },
  snippets: [
    { id: 'public', icon: 'globe', title: 'Public pages', sub: 'Anyone visiting sanvifertility.in', code: SNIPPET('sales') },
    { id: 'login', icon: 'lock', title: 'Behind a login', sub: 'Pages only signed-in patients see', code: SNIPPET('support') }
  ],
  snippetsFooter: 'Already on your site? Nothing to do. The full key was shown once on 6 Oct; make a new one only to add Orb somewhere new or replace a lost key.',
  wherePaste: [
    { title: 'On every page', body: 'Paste it just before </body>. Site builders call this custom code or footer scripts.' },
    { title: 'Check it worked', body: 'Open any page with the snippet. The status above changes to “Widget seen” within a minute.' },
    { title: 'Live comes from a real chat', body: 'Orb shows Live only after the first visitor chat on your site.' }
  ],
  keys: [
    { id: 'k1', label: '6 Oct 2026', keyMasked: 'tk_3f9a1c…', made: '6 Oct', lastUsed: '4 min ago', revoked: false },
    { id: 'k2', label: 'Old test page', keyMasked: 'tk_81d02e…', made: '6 Oct', lastUsed: 'Revoked 9 Oct', revoked: true }
  ]
};

export default function InstallPage() {
  return (
    <>
      <Head><title>Install · Orb</title></Head>
      <OrbShell>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-7">
          <div>
            <h1 className="orb-page-title text-orb-ink">Install</h1>
            <p className="mt-1 orb-body text-orb-secondary">Put Orb on your website: one line of code, pasted once on every page.</p>
          </div>

          <InstallStatusCard {...DATA.status} />

          <div className="grid grid-cols-1 gap-7 lg:grid-cols-[630fr_480fr]">
            <SnippetsCard snippets={DATA.snippets} footerNote={DATA.snippetsFooter} />
            <WherePasteCard sections={DATA.wherePaste} />
          </div>

          <KeysCard keys={DATA.keys} />
        </div>
      </OrbShell>
    </>
  );
}
