import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import Overview from '../../components/workspace/Overview';
import { Card, CodeBlock, PageHeader, SecretField } from '../../components/ui';
import { embedSnippet } from '../../lib/api';
import { takeSignupHandoff } from '../../lib/signupHandoff';

export default function DashboardOverview() {
  const { tenant, ws, name } = useSession();
  const [welcome, setWelcome] = useState(null);

  // The signup wizard hands over the first API key once; show it, then it's gone.
  useEffect(() => {
    const handoff = takeSignupHandoff();
    if (handoff && handoff.slug === tenant.slug) setWelcome(handoff);
  }, [tenant.slug]);

  return (
    <>
      <PageHeader title={welcome ? 'Your bots are live 🎉' : `Welcome back${name ? `, ${String(name).split(/[\s@]/)[0]}` : ''}`}
        description={welcome ? `Trained on ${welcome.documentsCreated} document${welcome.documentsCreated === 1 ? '' : 's'}. Copy your key now — it's shown only this once.` : `${tenant.name} · Support and Sales bots`} />

      {welcome && (
        <Card className="mb-6 space-y-4 border-cyan-400/25 p-5 shadow-glow">
          <SecretField value={welcome.apiKey} label="Your API key" />
          <CodeBlock filename="index.html" code={embedSnippet(welcome.slug, welcome.apiKey)} />
          <p className="text-[13px] text-fg-3">
            Paste the snippet before <code className="text-fg-2">{'</body>'}</code> on your site. Lost it later? Issue a new key in{' '}
            <Link href="/dashboard/keys" className="text-cyan-300 hover:underline">API keys</Link>.
          </p>
        </Card>
      )}

      <Overview ws={ws} tenant={tenant} base="/dashboard" />
    </>
  );
}
DashboardOverview.getLayout = clientLayout;
