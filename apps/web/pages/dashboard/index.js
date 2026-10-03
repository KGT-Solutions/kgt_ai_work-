import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clientLayout, useSession } from '../../components/shell/DashboardShell';
import Overview from '../../components/workspace/Overview';
import EmbedSnippets from '../../components/workspace/EmbedSnippets';
import { Card, PageHeader, SecretField } from '../../components/ui';
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
        <Card className="mb-6 space-y-4 border-brand-400/25 p-5 shadow-glow">
          <SecretField value={welcome.apiKey} label="Your API key" />
          <EmbedSnippets slug={welcome.slug} apiKey={welcome.apiKey} />
          <p className="text-[13px] text-fg-3">
            Lost your key later? Issue a new one in{' '}
            <Link href="/dashboard/keys" className="text-brand-300 hover:underline">API keys</Link>.
          </p>
        </Card>
      )}

      <Overview ws={ws} tenant={tenant} base="/dashboard" />
    </>
  );
}
DashboardOverview.getLayout = clientLayout;
