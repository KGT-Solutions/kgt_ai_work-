import Link from 'next/link';
import { useEffect, useState } from 'react';
import { staffLayout } from '../../components/shell/DashboardShell';
import { Badge, Button, ButtonLink, Card, EmptyState, Input, PageHeader, Select, Skeleton } from '../../components/ui';
import { useToast } from '../../components/ui/toast';
import { IconBuilding, IconPlus, IconSearch } from '../../components/ui/icons';
import { Stat, pct, usd } from '../../components/workspace/UsagePanel';
import { api } from '../../lib/api';

// KGT staff master control: every registered company with its contact,
// knowledge, keys and usage, and activate / deactivate.
export default function StaffCompanies() {
  const toast = useToast();
  const [tenants, setTenants] = useState(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [busyId, setBusyId] = useState(null);

  const load = () => api.listTenants().then(setTenants).catch((e) => toast.error(e.message));
  useEffect(() => { load(); }, []);

  const toggle = async (t) => {
    setBusyId(t.id);
    try {
      await api.updateTenant(t.id, { active: !t.active });
      toast.success(t.active ? `${t.name} deactivated — dashboard, keys and widget stop immediately.` : `${t.name} reactivated.`);
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const q = query.trim().toLowerCase();
  const visible = (tenants || []).filter((t) => (status === 'all' || (status === 'active') === t.active) &&
    (!q || [t.name, t.slug, t.industryLabel, t.signupEmail, ...t.metrics.accounts.map((a) => a.email)].some((v) => String(v || '').toLowerCase().includes(q))));
  const sum = (f) => (tenants || []).reduce((a, t) => a + f(t), 0);
  const botSum = (bot, k) => sum((t) => t.metrics.byBot[bot][k]);
  const platformAnswers = sum((t) => t.metrics.llmCalls + t.metrics.cacheHits);

  return (
    <>
      <PageHeader title="Companies" description="Every client on KGT AI Hub — staff only."
        actions={<ButtonLink href="/admin/tenants/new" variant="primary"><IconPlus className="h-4 w-4" />New company</ButtonLink>} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Stat label="Companies" value={tenants && tenants.length}
          sub={tenants && `${tenants.filter((t) => t.active).length} active · ${sum((t) => t.metrics.documents).toLocaleString('en-US')} documents`} />
        <Stat label="Questions" value={tenants && sum((t) => t.metrics.questions)} sub={tenants && `${sum((t) => t.metrics.conversations).toLocaleString('en-US')} conversations`} />
        <Stat label="Support Bot cost" value={tenants && usd(botSum('support', 'costUsd'))}
          sub={tenants && `${botSum('support', 'aiAnswers').toLocaleString('en-US')} AI answers · ${botSum('support', 'tokensPerDay').toLocaleString('en-US')} tokens/day`} />
        <Stat label="Sales Bot cost" value={tenants && usd(botSum('sales', 'costUsd'))}
          sub={tenants && `${botSum('sales', 'aiAnswers').toLocaleString('en-US')} AI answers · ${botSum('sales', 'tokensPerDay').toLocaleString('en-US')} tokens/day`} />
        <Stat label="Cache savings" value={tenants && usd(sum((t) => t.metrics.savedCostUsd))}
          sub={tenants && `${pct(platformAnswers ? sum((t) => t.metrics.cacheHits) / platformAnswers : 0)} of answers from cache · total spend ${usd(sum((t) => t.metrics.estimatedCostUsd))}`} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-white/[0.06] p-4 sm:flex-row">
          <div className="relative flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search company, industry or email" className="pl-9" aria-label="Search companies" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44" aria-label="Status">
            <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Deactivated</option>
          </Select>
        </div>
        {!tenants ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div> : visible.length === 0 ? (
          <div className="p-6"><EmptyState icon={<IconBuilding className="h-5 w-5" />} title={tenants.length ? 'No companies match' : 'No companies yet'}>They appear here as soon as they finish signup.</EmptyState></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left text-sm">
              <thead className="text-xs text-fg-3">
                <tr className="border-b border-white/[0.06]">
                  <th className="px-4 py-3 font-medium">Company</th><th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 text-right font-medium">Docs</th><th className="px-4 py-3 font-medium">Keys</th>
                  <th className="px-4 py-3 font-medium">Activity</th>
                  <th className="px-4 py-3 font-medium text-cyan-300/90">Support Bot</th><th className="px-4 py-3 font-medium text-violet-300/90">Sales Bot</th>
                  <th className="px-4 py-3 text-right font-medium">Total cost</th><th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {visible.map((t) => {
                  const m = t.metrics;
                  const contact = m.accounts[0];
                  return (
                    <tr key={t.id} className="hover:bg-white/[0.015]">
                      <td className="px-4 py-3 align-top">
                        <Link href={`/admin/tenants/${t.id}`} className="font-medium text-fg hover:text-cyan-300">{t.name}</Link>
                        <p className="text-xs text-fg-3">{t.industryLabel}</p>
                        <p className="font-mono text-[11px] text-fg-3">{t.slug} · joined {new Date(t.createdAt).toLocaleDateString()}</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {contact ? <><p className="text-fg-2">{contact.email}</p><p className="text-xs text-fg-3">{contact.name || '—'} · last sign-in {contact.lastLoginAt ? new Date(contact.lastLoginAt).toLocaleDateString() : 'never'}</p></>
                          : <p className="text-xs text-fg-3">{t.signupEmail || 'Staff-created · no login'}</p>}
                      </td>
                      <td className="px-4 py-3 text-right align-top tabular-nums text-fg-2">{m.documents}</td>
                      <td className="px-4 py-3 align-top">
                        <p className="text-fg-2">{m.activeKeys} active</p>
                        <p className="text-xs text-fg-3">{m.keyLastUsedAt ? `used ${new Date(m.keyLastUsedAt).toLocaleDateString()}` : 'not used yet'}</p>
                      </td>
                      <td className="px-4 py-3 align-top tabular-nums">
                        <p className="text-fg-2">{m.questions} questions</p>
                        <p className="text-xs text-fg-3">{m.conversations} conversations</p>
                      </td>
                      <BotCell b={m.byBot.support} />
                      <BotCell b={m.byBot.sales} />
                      <td className="px-4 py-3 text-right align-top tabular-nums">
                        <p className="text-fg">{usd(m.estimatedCostUsd)}</p>
                        {m.savedCostUsd > 0 && <p className="text-xs text-emerald-300">{usd(m.savedCostUsd)} saved</p>}
                        <p className="text-xs text-fg-3">{m.tokensPerDay.toLocaleString('en-US')} tokens/day</p>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col items-start gap-1.5">
                          <Badge tone={t.active ? 'success' : 'neutral'} dot>{t.active ? 'Active' : 'Deactivated'}</Badge>
                          <Button size="sm" variant="ghost" className="-ml-2" onClick={() => toggle(t)} loading={busyId === t.id}>{t.active ? 'Deactivate' : 'Reactivate'}</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
StaffCompanies.getLayout = staffLayout;

// One bot's all-time ledger for one company. tokens/day is the last-7-day average.
function BotCell({ b }) {
  return (
    <td className="px-4 py-3 align-top tabular-nums">
      <p className="text-fg-2">{b.aiAnswers.toLocaleString('en-US')} answers · {usd(b.costUsd)}</p>
      <p className="text-xs text-fg-3">{b.tokens.toLocaleString('en-US')} tokens · {b.tokensPerDay.toLocaleString('en-US')}/day</p>
      <p className="text-xs text-fg-3">{b.cacheHits ? `${b.cacheHits.toLocaleString('en-US')} cached (${pct(b.cacheHitRate)})` : 'no cache hits'}</p>
    </td>
  );
}
