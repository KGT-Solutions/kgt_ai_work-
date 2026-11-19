import { useState } from 'react';
import Head from 'next/head';
import OrbShell from '../../components/shell/OrbShell';
import { Banner, Button, Pill, IconPlay } from '../../components/orb';
import { TestChatCard, KnowledgeReadinessPanel, SourcesCard } from '../../components/orb/testorb';

// Test Orb page. DATA CONTAINER: owns the transcript + panels data; swap for an
// API/state source later (the test chat would stream from the chat engine).

const DATA = {
  chat: {
    messages: [
      { role: 'visitor', text: 'How much does one IVF cycle cost at Sanvi?' },
      { role: 'orb', text: 'One IVF cycle at Sanvi starts at ₹1,65,000, including medicines up to ₹40,000. ICSI adds ₹25,000. You can pay in 0% EMI over 6 to 18 months.', source: 'From Fees and packages · Policies & pricing' },
      { role: 'visitor', text: 'Do you accept Star Health insurance for IVF?' },
      { role: 'orb', text: 'I don’t have Sanvi’s insurance details yet. I can pass your question to the Sanvi team with this chat attached, and they’ll reply by phone or email.', source: 'No matching knowledge', ticket: true },
      { role: 'visitor', text: 'What is an AMH test and do I need one?' },
      { role: 'orb', text: 'AMH is a blood test that estimates your egg reserve. Sanvi’s doctors usually ask for it before planning IVF or egg freezing. It costs ₹1,800 and results come in 2 days.', source: 'From Fertility tests FAQ · FAQ' }
    ],
    suggested: ['Which doctors work at Kharadi?', 'What is IUI?', 'How do I book a first consultation?']
  },
  readiness: {
    score: 64, max: 100,
    status: { label: 'Moderate', tone: 'neutral' },
    marker: { at: 80, label: 'Ready 80' },
    note: 'Below Ready because three common topics aren’t covered yet: insurance and TPA cover, branch hours on Sundays, and test prices. Not capped: Orb has 13,910 characters.',
    checkedAt: 'Checked 6 Oct, 3:12 pm, after your last upload',
    toAddTitle: 'What to add to reach Ready (80%)',
    toAdd: ['Insurance and TPA cover', 'Branch hours, including Sundays', 'Test prices: ERA, semen analysis']
  },
  sources: {
    subtitle: '4 sources · 13,910 characters',
    sources: [
      { title: 'sanvifertility.in', sub: '11 pages', category: { label: 'Overview' }, chars: '9,820' },
      { title: 'Doctors and branches', sub: 'Written entry', category: { label: 'Overview' }, chars: '2,150' },
      { title: 'Fees and packages', sub: 'PDF, 2 pages', category: { label: 'Policies & pricing' }, chars: '1,240' },
      { title: 'Fertility tests FAQ', sub: 'Written entry', category: { label: 'FAQ' }, chars: '700' }
    ],
    note: (
      <>
        <strong className="orb-small-strong text-orb-ink">FAQ</strong> is read first for patient questions.{' '}
        <strong className="orb-small-strong text-orb-ink">Policies &amp; pricing</strong> is trusted for money questions.{' '}
        <strong className="orb-small-strong text-orb-ink">Overview</strong> says what you do.
      </>
    )
  }
};

export default function TestOrbPage() {
  const [lang, setLang] = useState('en');

  return (
    <>
      <Head><title>Test Orb · Orb</title></Head>
      <OrbShell>
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-7">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="orb-page-title text-orb-ink">Test Orb</h1>
              <Pill tone="yellow">Ready to install</Pill>
            </div>
            <p className="mt-1 orb-body text-orb-secondary">Day 1 · 6 Oct. Orb answers only from your knowledge. Nothing is on your website yet.</p>
          </div>

          <Banner
            icon={<IconPlay size={16} />}
            title="Ask a few real patient questions."
            body="When you’re happy with the answers, install Orb on your site."
            action={<Button variant="primary" size="md">Install on your site</Button>}
          />

          <div className="grid grid-cols-1 gap-7 lg:grid-cols-[1fr_400px]">
            <TestChatCard {...DATA.chat} lang={lang} onLang={setLang} />
            <div className="flex flex-col gap-7">
              <KnowledgeReadinessPanel {...DATA.readiness} />
              <SourcesCard {...DATA.sources} />
            </div>
          </div>
        </div>
      </OrbShell>
    </>
  );
}
