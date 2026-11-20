import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { OrbAuthShell, OrbStepTracker } from '../../components/orb/auth';
import { CreateAccountStep, EnterCodeStep, CompanyStep, KnowledgeStep, TrainingStep, ReviewStep } from '../../components/orb/register';

// Orb onboarding wizard (Figma board "0 · Signup and onboarding", 595:1824).
// Five tracker steps; step 0 (Account) has two sub-screens: create → enter code.
// No sidebar; centered 1200px shell. (UI build — the create-workspace action is
// a placeholder redirect; wire it to the register API when ready.)
const STEPS = ['Account', 'Company', 'Knowledge', 'Training & bots', 'Create workspace'];

export default function OrbRegister() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [accountSub, setAccountSub] = useState('create'); // 'create' | 'code'
  const [email, setEmail] = useState('');

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
            <CreateAccountStep email={email} setEmail={setEmail} onSendCode={() => setAccountSub('code')} />
          )}
          {step === 0 && accountSub === 'code' && (
            <EnterCodeStep email={email} onDifferentEmail={() => setAccountSub('create')} onVerify={() => setStep(1)} />
          )}
          {step === 1 && <CompanyStep onContinue={() => setStep(2)} />}
          {step === 2 && <KnowledgeStep onBack={() => setStep(1)} onContinue={() => setStep(3)} />}
          {step === 3 && <TrainingStep onBack={() => setStep(2)} onContinue={() => setStep(4)} />}
          {step === 4 && <ReviewStep onBack={() => setStep(3)} onCreate={() => router.push('/testorb')} />}
        </div>
      </OrbAuthShell>
    </>
  );
}
