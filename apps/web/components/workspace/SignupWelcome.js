import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, SecretField } from '../ui';
import EmbedSnippets from './EmbedSnippets';
import { takeSignupHandoff } from '../../lib/signupHandoff';

// The one-time post-signup welcome: the plaintext API key (stored only as a hash
// on the server, so shown exactly once) plus the embed snippets. Self-contained
// so it can render on whichever dashboard page the wizard lands on — currently
// /dashboard/bots. It consumes the sessionStorage handoff on mount and matches it
// to the current tenant, then it's gone, so navigating elsewhere never re-shows
// it and only the account that just signed up ever sees it.
export default function SignupWelcome({ tenant }) {
  const [welcome, setWelcome] = useState(null);

  useEffect(() => {
    // Don't consume the one-time handoff until the tenant is known — takeSignupHandoff
    // removes it, so reading it before tenant.slug is set would discard the key for good.
    if (!tenant?.slug) return;
    const handoff = takeSignupHandoff();
    if (handoff && handoff.slug === tenant.slug) setWelcome(handoff);
  }, [tenant?.slug]);

  if (!welcome) return null;
  return (
    <Card className="mb-6 space-y-4 border-brand-400/25 p-5 shadow-glow">
      <div>
        <h2 className="text-lg font-semibold text-fg">Your bots are live 🎉</h2>
        <p className="mt-1 text-[13px] text-fg-3">
          Trained on {welcome.documentsCreated} document{welcome.documentsCreated === 1 ? '' : 's'}. Copy your key now — it's shown only this once.
        </p>
      </div>
      <SecretField value={welcome.apiKey} label="Your API key" />
      <EmbedSnippets slug={welcome.slug} apiKey={welcome.apiKey} />
      <p className="text-[13px] text-fg-3">
        Lost your key later? Issue a new one in{' '}
        <Link href="/dashboard/keys" className="text-brand-300 hover:underline">API keys</Link>.
      </p>
    </Card>
  );
}
