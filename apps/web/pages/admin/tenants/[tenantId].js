import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { staffLayout } from '../../../components/shell/DashboardShell';
import BotSandbox from '../../../components/workspace/BotSandbox';
import DocumentManager from '../../../components/workspace/DocumentManager';
import KeyVault from '../../../components/workspace/KeyVault';
import Overview from '../../../components/workspace/Overview';
import LeadsPanel from '../../../components/workspace/LeadsPanel';
import TicketsList from '../../../components/workspace/TicketsList';
import UsagePanel, { usd } from '../../../components/workspace/UsagePanel';
import { Badge, Button, Card, PageHeader, Skeleton, cx } from '../../../components/ui';
import { useToast } from '../../../components/ui/toast';
import { IconArrowLeft } from '../../../components/ui/icons';
import { api, staffWorkspace } from '../../../lib/api';

// KGT staff inside one company: profile, contact and status, then the same
// workspace components the company sees on its own dashboard.
const TABS = ['Overview', 'Documents', 'Test bots', 'API keys', 'Tickets', 'Leads', 'Usage'];

export default function StaffTenant() {
  const router = useRouter();
  const toast = useToast();
  const { tenantId } = router.query;
  const [tenant, setTenant] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [busy, setBusy] = useState(false);
  const ws = useMemo(() => (tenantId ? staffWorkspace(tenantId) : null), [tenantId]);

  const load = () => api.getTenant(tenantId).then(setTenant).catch((e) => toast.error(e.message));
  useEffect(() => { if (tenantId) load(); }, [tenantId]);

  const toggle = async () => {
    setBusy(true);
    try {
      await api.updateTenant(tenant.id, { active: !tenant.active });
      toast.success(tenant.active ? 'Deactivated — dashboard, keys and widget stop immediately.' : 'Reactivated.');
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!tenant || !ws) return <div className="space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-32" /><Skeleton className="h-64" /></div>;
  const m = tenant.metrics;

  return (
    <>
      <Link href="/admin" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg-2"><IconArrowLeft className="h-4 w-4" />All companies</Link>
      <PageHeader title={<span className="inline-flex flex-wrap items-center gap-3">{tenant.name}<Badge tone={tenant.active ? 'success' : 'neutral'} dot>{tenant.active ? 'Active' : 'Deactivated'}</Badge></span>}
        description={`${tenant.industryLabel} · ${tenant.slug}`}
        actions={<Button variant={tenant.active ? 'danger' : 'primary'} onClick={toggle} loading={busy}>{tenant.active ? 'Deactivate company' : 'Reactivate company'}</Button>} />

      <Card className="mb-6 p-5">
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Contact">{m.accounts.length ? m.accounts.map((a) => `${a.name ? `${a.name} · ` : ''}${a.email}`).join(', ') : tenant.signupEmail || 'Staff-created (no login)'}</Fact>
          <Fact label="Joined">{new Date(tenant.createdAt).toLocaleString()}</Fact>
          <Fact label="Support confidence gate">{Math.round(tenant.minConfidence * 100)}%</Fact>
          <Fact label="Knowledge">{m.documents} documents</Fact>
          <Fact label="API keys">{m.activeKeys} active{m.keyLastUsedAt ? `, last used ${new Date(m.keyLastUsedAt).toLocaleString()}` : ', not used yet'}</Fact>
          <Fact label="Usage">{m.conversations} conversations · {m.questions} questions · {m.llmCalls} AI answers (≈ {usd(m.estimatedCostUsd)}) · {m.cacheHits} from cache</Fact>
          <Fact label="Support · Sales">
            {m.byBot.support.aiAnswers} answers, {usd(m.byBot.support.costUsd)} · {m.byBot.sales.aiAnswers} answers, {usd(m.byBot.sales.costUsd)}
          </Fact>
        </dl>
      </Card>

      <div role="tablist" aria-label="Workspace" className="mb-6 flex gap-1 overflow-x-auto border-b border-white/[0.06]">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cx('relative whitespace-nowrap px-3 py-2.5 text-sm font-medium transition', tab === t ? 'text-fg' : 'text-fg-3 hover:text-fg-2')}>
            {t}
            {tab === t && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-400" />}
          </button>
        ))}
      </div>

      <div key={tab} className="animate-fade-up">
        {tab === 'Overview' && <Overview ws={ws} tenant={tenant} />}
        {tab === 'Documents' && <DocumentManager ws={ws} audience="staff" />}
        {tab === 'Test bots' && <BotSandbox ws={ws} tenant={tenant} />}
        {tab === 'API keys' && <KeyVault ws={ws} tenant={tenant} />}
        {tab === 'Tickets' && <TicketsList ws={ws} />}
        {tab === 'Leads' && <LeadsPanel ws={ws} />}
        {tab === 'Usage' && <UsagePanel ws={ws} />}
      </div>
    </>
  );
}
StaffTenant.getLayout = staffLayout;

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="mt-0.5 text-fg-2">{children}</dd>
    </div>
  );
}
