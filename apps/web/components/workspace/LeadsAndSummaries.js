import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Button, Input, Segmented } from '../ui';
import { useToast } from '../ui/toast';
import { IconMail } from '../ui/icons';
import LeadsPanel from './LeadsPanel';
import SessionsPanel from './SessionsPanel';
import ImprovementsPanel from './ImprovementsPanel';

// Leads & Summaries: the Leads view (visitors who left an email), the
// Sessions view (every conversation, summarized) and the Improvements view
// (conversations where a bot missed: a weak or no knowledge-base answer), plus who on the team
// gets the alert emails. The open view and session live in the URL
// (?view=sessions&session=<id>), so an alert email's link and the back
// button land in the right place. Used by the client dashboard and the
// staff console's tenant page.

const VIEWS = [{ value: 'leads', label: 'Leads' }, { value: 'sessions', label: 'Sessions' }, { value: 'improvements', label: 'Improvements' }];
const VIEW_IDS = VIEWS.map((v) => v.value);

function AlertRecipients({ ws }) {
  const toast = useToast();
  const [settings, setSettings] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { ws.getNotifications().then(setSettings).catch(() => {}); }, [ws]);
  if (!settings) return null;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      setSettings(await ws.updateNotifications(draft));
      setEditing(false);
      toast.success('Alert recipients saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const pct = Math.round((settings.lowConfidenceBelow ?? 0.25) * 100);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[13px] sm:flex-row sm:items-center sm:justify-between">
      <p className="flex min-w-0 items-start gap-2 text-fg-3">
        <IconMail className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
        <span className="min-w-0">
          New leads, handoffs and answers under {pct}% confidence are emailed to{' '}
          <span className="text-fg-2">{settings.recipients.length ? settings.recipients.join(', ') : 'no one yet'}</span>
          {!settings.teamEmail && settings.recipients.length > 0 && <span> (your account email)</span>}.
        </span>
      </p>
      {editing ? (
        <form onSubmit={save} className="flex w-full gap-2 sm:w-auto">
          <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="team@company.com, sales@company.com"
            aria-label="Alert email addresses" className="h-8 min-w-0 flex-1 text-[13px] sm:w-72" />
          <Button size="sm" type="submit" loading={saving}>Save</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => { setDraft(settings.teamEmail || ''); setEditing(true); }}>Change</Button>
      )}
    </div>
  );
}

export default function LeadsAndSummaries({ ws }) {
  const router = useRouter();
  const view = VIEW_IDS.includes(router.query.view) ? router.query.view : 'leads';
  const openSession = typeof router.query.session === 'string' ? router.query.session : null;

  const setQuery = useCallback((changes) => {
    const query = { ...router.query, ...changes };
    for (const k of Object.keys(query)) if (query[k] == null) delete query[k];
    router.push({ pathname: router.pathname, query }, undefined, { shallow: true, scroll: false });
  }, [router]);

  const setView = (v) => setQuery({ view: v === 'leads' ? null : v, session: null });
  // A session opens over the current view; from Leads (no drawer there) it opens in Sessions.
  const onOpenChange = useCallback(
    (id) => setQuery({ view: view === 'leads' ? 'sessions' : view, session: id }),
    [setQuery, view]
  );

  return (
    <div className="space-y-4">
      <Segmented label="View" options={VIEWS} value={view} onChange={setView} />
      <AlertRecipients ws={ws} />
      {view === 'leads' && <LeadsPanel ws={ws} onOpenSession={onOpenChange} />}
      {view === 'sessions' && <SessionsPanel ws={ws} openId={openSession} onOpenChange={onOpenChange} />}
      {view === 'improvements' && <ImprovementsPanel ws={ws} openId={openSession} onOpenChange={onOpenChange} />}
    </div>
  );
}
