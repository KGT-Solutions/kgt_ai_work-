import { useState } from 'react';
import { Field, Input, Button } from '..';
import { OrbFormCard } from '../auth';

// Step 1a (Figma 0A): create account — email + password.
export default function CreateAccountStep({ email, setEmail, onSendCode }) {
  const [password, setPassword] = useState('');
  return (
    <OrbFormCard
      title="Create your account"
      subtitle="Your sign-in for the Orb console. We’ll email you a code to confirm it’s your address."
      footer={<div className="flex justify-end"><Button variant="primary" size="md" onClick={onSendCode}>Send code</Button></div>}
    >
      <div className="flex flex-col gap-5">
        <Field label="Work email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@clinic.com" /></Field>
        <Field label="Password" helper="At least 10 characters."><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <div className="rounded-[10px] bg-orb-subtle px-3.5 py-3">
          <p className="orb-small text-orb-secondary">We save your progress so you can come back to it. We may email you a reminder; unsubscribe any time.</p>
        </div>
      </div>
    </OrbFormCard>
  );
}
