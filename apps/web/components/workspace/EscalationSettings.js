import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardHeader, Checkbox, Field, Input, Textarea, Spinner, cx } from '../ui';
import { IconShield } from '../ui/icons';
import { useToast } from '../ui/toast';

// Human Escalation settings (Feature 5): per-tenant trigger keywords, business
// hours and the reply-ETA message a visitor sees when a chat is handed off.
// Keywords only ROUTE a message to a person (they can't change an answer), so
// grounded replies and sandbox isolation are untouched. Business hours drive the
// ETA shown inside vs. outside hours.

const DAYS = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']
];

// The UI edits one open range per day; the API accepts several, so we read the
// first range and write a single-range array.
function hoursToRows(businessHours = {}) {
  const rows = {};
  for (const [key] of DAYS) {
    const r = Array.isArray(businessHours[key]) ? businessHours[key][0] : null;
    rows[key] = { open: r?.[0] || '09:00', close: r?.[1] || '17:00', enabled: !!r };
  }
  return rows;
}

function rowsToHours(rows) {
  const out = {};
  for (const [key] of DAYS) {
    const row = rows[key];
    if (row?.enabled) out[key] = [[row.open, row.close]];
  }
  return out;
}

export default function EscalationSettings({ ws }) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keywordsText, setKeywordsText] = useState('');
  const [keywordsEnabled, setKeywordsEnabled] = useState(true);
  const [timezone, setTimezone] = useState('');
  const [rows, setRows] = useState(() => hoursToRows({}));
  const [etaMinutes, setEtaMinutes] = useState('');
  const [offHoursText, setOffHoursText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await ws.getEscalation();
      setKeywordsText((s.triggerKeywords || []).join(', '));
      setKeywordsEnabled(s.keywordsEnabled !== false);
      setTimezone(s.businessTimezone || '');
      setRows(hoursToRows(s.businessHours || {}));
      setEtaMinutes(s.replyEtaMinutes != null ? String(s.replyEtaMinutes) : '');
      setOffHoursText(s.offHoursEtaText || '');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [ws, toast]);

  useEffect(() => { load(); }, [load]);

  const setRow = (key, patch) => setRows((r) => ({ ...r, [key]: { ...r[key], ...patch } }));

  const save = async () => {
    setSaving(true);
    try {
      const triggerKeywords = keywordsText.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
      await ws.saveEscalation({
        triggerKeywords,
        keywordsEnabled,
        businessTimezone: timezone.trim() || null,
        businessHours: rowsToHours(rows),
        replyEtaMinutes: etaMinutes === '' ? null : Number(etaMinutes),
        offHoursEtaText: offHoursText.trim() || null
      });
      toast.success('Escalation settings saved.');
      await load();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const guessTz = () => {
    try { setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || ''); } catch { /* ignore */ }
  };

  if (loading) {
    return <Card className="flex items-center gap-2 p-6 text-sm text-fg-3"><Spinner className="h-4 w-4" />Loading escalation settings…</Card>;
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader icon={<IconShield className="h-4 w-4" />} title="Escalation &amp; reply times"
        description="Decide what hands a chat off to a person, and what reply time visitors are told to expect." />
      <div className="space-y-7 p-5 sm:p-6">
        {/* Trigger keywords */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-[13px] font-semibold text-fg">Trigger keywords</h4>
            <Checkbox checked={keywordsEnabled} onChange={(e) => setKeywordsEnabled(e.target.checked)}>Enabled</Checkbox>
          </div>
          <Field htmlFor="esc-keywords"
            hint="Comma-separated. If a visitor's message contains one of these (as a whole word), the chat hands off to your team — on top of the built-in “talk to a human” detection.">
            <Textarea id="esc-keywords" rows={2} value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)} disabled={!keywordsEnabled}
              placeholder="refund, complaint, cancel my order, speak to manager" />
          </Field>
        </section>

        {/* Business hours */}
        <section className="space-y-3 border-t border-white/[0.06] pt-6">
          <h4 className="text-[13px] font-semibold text-fg">Business hours</h4>
          <Field label="Timezone" htmlFor="esc-tz" hint='An IANA timezone, e.g. "Asia/Kolkata". Leave blank for UTC.'>
            <div className="flex gap-2">
              <Input id="esc-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Asia/Kolkata" className="sm:max-w-xs" />
              <Button type="button" size="sm" variant="ghost" onClick={guessTz}>Use mine</Button>
            </div>
          </Field>
          <div className="space-y-1.5">
            {DAYS.map(([key, label]) => {
              const row = rows[key];
              return (
                <div key={key} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                  <label className="flex w-32 items-center gap-2 text-[13px] text-fg-2">
                    <Checkbox checked={row.enabled} onChange={(e) => setRow(key, { enabled: e.target.checked })}>{label}</Checkbox>
                  </label>
                  <div className={cx('flex items-center gap-2', !row.enabled && 'opacity-40')}>
                    <Input type="time" value={row.open} disabled={!row.enabled} onChange={(e) => setRow(key, { open: e.target.value })} className="w-32" />
                    <span className="text-fg-3">to</span>
                    <Input type="time" value={row.close} disabled={!row.enabled} onChange={(e) => setRow(key, { close: e.target.value })} className="w-32" />
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Reply ETA */}
        <section className="space-y-4 border-t border-white/[0.06] pt-6">
          <h4 className="text-[13px] font-semibold text-fg">Reply ETA</h4>
          <Field label="During business hours, reply within (minutes)" htmlFor="esc-eta"
            hint="Shown to a visitor when they're handed off inside business hours. Leave blank for a generic “as soon as we can”.">
            <Input id="esc-eta" type="number" min="1" value={etaMinutes}
              onChange={(e) => setEtaMinutes(e.target.value)} placeholder="30" className="sm:max-w-[12rem]" />
          </Field>
          <Field label="Outside business hours message" htmlFor="esc-off"
            hint="Shown when a visitor is handed off outside business hours. Leave blank for a generic “we'll get back to you when we're back”.">
            <Textarea id="esc-off" rows={2} value={offHoursText} onChange={(e) => setOffHoursText(e.target.value)}
              placeholder="We're closed right now — our team will reply the next working day." />
          </Field>
        </section>

        <div className="flex justify-end border-t border-white/[0.06] pt-5">
          <Button variant="primary" onClick={save} loading={saving} disabled={saving}>Save settings</Button>
        </div>
      </div>
    </Card>
  );
}
