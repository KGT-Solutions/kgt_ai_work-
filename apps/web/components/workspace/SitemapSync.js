import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, Field, Input, Skeleton, Spinner, cx } from '../ui';
import { useToast } from '../ui/toast';
import { IconGlobe } from '../ui/icons';

// Full-site sitemap sync, weekly auto-refresh & change reports (Feature 2,
// apps/api/src/services/knowledgeSync.js). Set the website to keep in sync,
// optionally turn on the weekly background refresh, run a sync on demand, and
// review the change report (pages added / updated / removed / unchanged / errors)
// for every run. Works through `ws`, so it only ever reaches the allowed tenant.

// Must match CRAWL_CONSENT_STATEMENT (apps/api/src/services/shared/crawlConsent.js).
const CRAWL_CONSENT_TEXT =
  'I am an authorized representative and legally permit the KGT Solutions AI crawler to access and extract content from this domain.';

const STATUS_TONE = { added: 'success', updated: 'blue', removed: 'danger', unchanged: 'neutral', error: 'warning', skipped: 'warning' };

function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleString(); } catch { return String(d); }
}

export default function SitemapSync({ ws, audience }) {
  const toast = useToast();
  const isClient = audience === 'client';
  const [source, setSource] = useState(null);
  const [runs, setRuns] = useState(null);
  const [url, setUrl] = useState('');
  const [weekly, setWeekly] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [openRun, setOpenRun] = useState(null); // full run detail

  const loadRuns = () => ws.listCrawlRuns().then((r) => setRuns(r.runs || [])).catch((e) => toast.error(e.message));
  const loadSource = () => ws.getCrawlSource().then((s) => { setSource(s); setUrl(s.url || ''); setWeekly(!!s.weeklyEnabled); }).catch((e) => toast.error(e.message));
  useEffect(() => { loadSource(); loadRuns(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ws]);

  const save = async () => {
    setSaving(true);
    try {
      const s = await ws.saveCrawlSource({ url: url.trim(), weeklyEnabled: weekly });
      setSource(s);
      toast.success('Website sync settings saved.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    if (!url.trim()) { toast.error('Enter your website address first.'); return; }
    if (isClient && !authorized && !source?.url) { toast.error('Tick the authorization box to continue.'); return; }
    setSyncing(true);
    try {
      const run = await ws.syncCrawlSource({ url: url.trim(), authorized });
      const c = run?.report?.counts || run || {};
      toast.success(`Sync complete — ${run.pagesAdded ?? c.added ?? 0} added, ${run.pagesUpdated ?? c.updated ?? 0} updated, ${run.pagesRemoved ?? c.removed ?? 0} removed.`);
      await loadSource();
      await loadRuns();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSyncing(false);
    }
  };

  const showRun = async (id) => {
    try { setOpenRun(await ws.getCrawlRun(id)); } catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Full-site website sync"
          description="Discover every page from your site's sitemap, import them, and keep them up to date — with a change report for each run." />
        <div className="space-y-4 p-5">
          <Field label="Website" htmlFor="sync-url"
            hint="We read your sitemap.xml (and robots.txt) to find pages across the whole site, then import each as a document. Same-domain only.">
            <div className="relative">
              <IconGlobe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-3" />
              <Input id="sync-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" className="pl-9" disabled={saving || syncing} />
            </div>
          </Field>

          <Checkbox checked={weekly} onChange={(e) => setWeekly(e.target.checked)} disabled={saving || syncing}>
            Automatically re-sync this site once a week
          </Checkbox>

          {isClient && !source?.url && (
            <Checkbox checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} disabled={syncing}>{CRAWL_CONSENT_TEXT}</Checkbox>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" loading={saving} onClick={save}>Save settings</Button>
            <Button type="button" variant="primary" loading={syncing} disabled={!url.trim()} onClick={syncNow}>
              {syncing ? 'Syncing — up to a minute…' : 'Sync now'}
            </Button>
            {source && (
              <span className="text-[12px] text-fg-3">
                Last run: {fmtDate(source.lastRunAt)}{source.lastStatus ? ` · ${source.lastStatus}` : ''}
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className="border-b border-white/[0.06] px-5 py-4">
          <h3 className="text-sm font-semibold text-fg">Change reports</h3>
          <p className="mt-0.5 text-[13px] text-fg-3">What changed on each sync — pages added, updated, removed, unchanged and any errors.</p>
        </div>
        <div className="p-5">
          {!runs ? (
            <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : runs.length === 0 ? (
            <EmptyState icon={<IconGlobe className="h-5 w-5" />} title="No syncs yet">Run a sync above to build your first change report.</EmptyState>
          ) : (
            <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.06]">
              {runs.map((run) => (
                <li key={run.id} className="bg-white/[0.01]">
                  <button type="button" onClick={() => (openRun?.id === run.id ? setOpenRun(null) : showRun(run.id))} className="w-full px-4 py-3 text-left" aria-expanded={openRun?.id === run.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'neutral'} dot>{run.status}</Badge>
                      <span className="text-sm text-fg">{fmtDate(run.startedAt)}</span>
                      <span className="text-[12px] text-fg-3">{run.trigger === 'scheduled' ? 'weekly' : 'manual'}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <CountBadge n={run.pagesAdded} tone="success" label="added" />
                      <CountBadge n={run.pagesUpdated} tone="blue" label="updated" />
                      <CountBadge n={run.pagesRemoved} tone="danger" label="removed" />
                      <CountBadge n={run.pagesUnchanged} tone="neutral" label="unchanged" />
                      <CountBadge n={run.errorsCount} tone="warning" label="errors" />
                    </div>
                  </button>
                  {openRun?.id === run.id && <RunDetail run={openRun} />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

function CountBadge({ n, tone, label }) {
  if (!n) return null;
  return <Badge tone={tone}><span className="tabular-nums">{n}</span>&nbsp;{label}</Badge>;
}

function RunDetail({ run }) {
  const pages = run?.report?.pages || [];
  if (run?.report?.error) return <div className="border-t border-white/[0.05] px-4 py-3 text-[12.5px] text-rose-300">{run.report.error}</div>;
  if (!pages.length) return <div className="border-t border-white/[0.05] px-4 py-3 text-[12.5px] text-fg-3">No page-level detail for this run.</div>;
  return (
    <div className="border-t border-white/[0.05] px-4 py-3">
      <ul className="max-h-72 space-y-1 overflow-auto text-[12.5px]">
        {pages.map((p, i) => (
          <li key={i} className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[p.status] || 'neutral'}>{p.status}</Badge>
            {p.url ? (
              <a href={p.url} target="_blank" rel="noreferrer" className={cx('min-w-0 flex-1 truncate', 'text-brand-300 hover:underline')} title={p.url}>{p.title || p.url}</a>
            ) : (
              <span className="min-w-0 flex-1 truncate text-fg-3">{p.error || p.title || '—'}</span>
            )}
            {p.error && p.url && <span className="shrink-0 text-rose-300" title={p.error}>!</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
