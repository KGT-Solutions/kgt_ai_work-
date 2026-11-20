import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { OrbAuthShell, OrbStepTracker } from '../../components/orb/auth';
import { CreateAccountStep, EnterCodeStep, CompanyStep, KnowledgeStep, TrainingStep, ReviewStep } from '../../components/orb/register';
import { setToken } from '../../lib/api';
import { putSignupHandoff } from '../../lib/signupHandoff';

// Orb onboarding wizard (Figma board "0 · Signup and onboarding", 595:1824).
// Five tracker steps; step 0 (Account) has two sub-screens: create → enter code.
// State is lifted here and the steps call the onboarding mutation hooks
// (lib/onboarding.js) — see each step component.
const STEPS = ['Account', 'Company', 'Knowledge', 'Training & bots', 'Create workspace'];

export default function OrbRegister() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [accountSub, setAccountSub] = useState('create'); // 'create' | 'code'

  // ── Lifted onboarding state ───────────────────────────────────────────────
  const [account, setAccount] = useState({ email: '', password: '' });
  const [verification, setVerification] = useState(null); // { email, token } after OTP
  const [company, setCompany] = useState({ companyName: '', contactName: '', industry: 'fertility', industryLabel: 'Fertility & IVF clinic' });
  const [bots, setBots] = useState({ support: true, sales: true });
  const [entries, setEntries] = useState([]);

  // On a successful /complete: sign in and hand off to the test page.
  const onComplete = (data) => {
    setToken('client', data.token);
    putSignupHandoff({
      apiKey: data.apiKey, slug: data.slug, documentsCreated: data.documentsCreated,
      pagesDiscovered: data.pagesDiscovered, pagesTrained: data.pagesTrained
    });
    router.push('/testorb');
  };

  const topRight = (
    <span className="orb-small text-orb-secondary">
      Already started? <Link href="/orb-signin" className="orb-small-medium text-orb-ink underline">Log in to continue</Link>
    </span>
  );

  return (
    <>
      <Head><title>Set up Orb</title></Head>
      <OrbAuthShell right={topRight}>
        <div className="flex flex-col items-center gap-7">
          <div className="text-center">
            <h1 className="orb-page-title text-orb-ink">Set up Orb for your clinic</h1>
            <p className="mt-1.5 orb-body text-orb-secondary">Five steps. At the end you can test Orb before it goes on your site.</p>
          </div>

          <OrbStepTracker steps={STEPS} current={step} />

          {step === 0 && accountSub === 'create' && (
            <CreateAccountStep account={account} setAccount={setAccount} onSent={() => setAccountSub('code')} />
          )}
          {step === 0 && accountSub === 'code' && (
            <EnterCodeStep
              email={account.email.trim()}
              onDifferentEmail={() => setAccountSub('create')}
              onVerified={(v) => { setVerification(v); setStep(1); }}
            />
          )}
          {step === 1 && <CompanyStep company={company} setCompany={setCompany} onBack={() => setStep(0)} onContinue={() => setStep(2)} />}
          {step === 2 && <KnowledgeStep entries={entries} setEntries={setEntries} companyName={company.companyName} onBack={() => setStep(1)} onContinue={() => setStep(3)} />}
          {step === 3 && (
            <TrainingStep
              bots={bots} setBots={setBots} company={company} entries={entries}
              onBack={() => setStep(2)} onContinue={() => setStep(4)}
            />
          )}
          {step === 4 && (
            <ReviewStep
              account={account} verification={verification} company={company} bots={bots} entries={entries}
              onBack={() => setStep(3)} onComplete={onComplete}
            />
          )}
        </div>
      </OrbAuthShell>
    </>
  );
}
