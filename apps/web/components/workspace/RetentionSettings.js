import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardHeader, Spinner } from '../ui';
import { IconTrash } from '../ui/icons';
import { useToast } from '../ui/toast';

// Chat-log retention (Feature 16): conversations are kept for a FIXED window on
// the KGT server (30 days) and then removed — there is no tenant-configurable
// period. The same window applies to the conversation copy saved on a lead: its
// transcript is redacted while the lead's contact/status are kept, so no raw
// conversation content outlives the window. This panel states the policy
// (read-only), points tenants who want their data on their own server to the
// team, and offers an on-demand purge of anything already past the window.
// Deleting history is irreversible, so the purge always previews the count first
// (a dry-run) and confirms before the real delete.

export default function RetentionSettings({ ws, onPurged }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [settings, setSettings] = useState(null);
  const [preview, setPreview] = useState(null); // { eligible, cutoff } from a dry-run

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSettings(await ws.getRetention());
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [ws, toast]);

  useEffect(() => { load(); }, [load]);

  const runPreview = async () => {
    setPurging(true);
    try {
      setPreview(await ws.purgeSessions({ dryRun: true }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPurging(false);
    }
  };

  const runPurge = async () => {
    if (!preview?.eligible) return;
    if (!window.confirm(`Permanently delete ${preview.eligible} conversation(s) older than the ${days}-day retention window? This cannot be undone.`)) return;
    setPurging(true);
    try {
      const res = await ws.purgeSessions({ dryRun: false });
      toast.success(`Purged ${res.deleted} conversation(s).`);
      setPreview(null);
      await load();
      onPurged?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPurging(false);
    }
  };

  if (loading) {
    return <Card className="flex items-center gap-2 p-6 text-sm text-fg-3"><Spinner className="h-4 w-4" />Loading retention…</Card>;
  }

  const days = settings?.retentionDays ?? 30;

  return (
    <Card className="overflow-hidden">
      <CardHeader icon={<IconTrash className="h-4 w-4" />} title="Chat-log retention"
        description="How long conversations are kept on the KGT server before they're automatically removed." />
      <div className="space-y-5 p-5 sm:p-6">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
          <p className="text-[13.5px] leading-relaxed text-fg-2">
            Chat logs are retained for <span className="font-semibold text-fg">{days} days</span> on KGT&apos;s
            server, then permanently removed along with their messages. Any conversation copy saved on a
            lead is redacted on the same schedule — after {days} days the transcript is cleared, while the
            lead&apos;s contact details and status are kept as your business record. This period is fixed and
            managed by KGT — it can&apos;t be changed from the dashboard.
          </p>
        </div>

        {/* Self-hosted / own-server data note. */}
        <p className="rounded-xl border border-brand-400/25 bg-brand-400/[0.06] px-4 py-3 text-[13px] leading-relaxed text-brand-100">
          Want your chat data stored on your own server instead? <span className="font-medium">Contact the team</span> and
          we&apos;ll set that up for you.
        </p>

        {settings?.lastPurgeAt && (
          <p className="text-[12.5px] text-fg-3">
            Last purge: {new Date(settings.lastPurgeAt).toLocaleString()}
            {settings.lastPurgedCount != null && ` · ${settings.lastPurgedCount} removed`}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-5">
          <Button variant="secondary" onClick={runPreview} loading={purging && !preview} disabled={purging}>
            Preview what would be deleted
          </Button>
          {preview && (
            preview.eligible > 0 ? (
              <Button variant="danger" onClick={runPurge} loading={purging}>Delete {preview.eligible} now</Button>
            ) : (
              <span className="text-[13px] text-fg-3">Nothing to purge — no conversations are older than {days} days.</span>
            )
          )}
        </div>
        {preview?.eligible > 0 && (
          <p className="rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-[13px] leading-relaxed text-amber-100">
            {preview.eligible} conversation(s) last active before {new Date(preview.cutoff).toLocaleDateString()} would be permanently deleted, along with their messages.
          </p>
        )}
      </div>
    </Card>
  );
}
