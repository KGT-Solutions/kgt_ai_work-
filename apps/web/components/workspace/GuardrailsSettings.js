import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, Skeleton } from '../ui';
import { useToast } from '../ui/toast';
import { IconLock, IconX } from '../ui/icons';

// Minimal console for the Guardrails scaffold: read/write the one TenantGuardrails
// row via ws.getGuardrails / updateGuardrails. Enforcement of these settings is
// added later; this screen just persists them.

const numOrNull = (s) => { const v = String(s).trim(); if (!v) return null; const n = Number(v); return Number.isFinite(n) ? n : NaN; };

export default function GuardrailsSettings({ ws }) {
  const toast = useToast();
  const [g, setG] = useState(null);
  const [saving, setSaving] = useState(false);
  const [country, setCountry] = useState('');

  useEffect(() => { ws.getGuardrails().then(setG).catch((e) => toast.error(e.message)); }, [ws]);
  if (!g) return <Skeleton className="h-96" />;

  const set = (patch) => setG((prev) => ({ ...prev, ...patch }));
  const addCountry = () => {
    const code = country.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) { toast.error('Enter a 2-letter country code, e.g. RU'); return; }
    if (!g.blockedCountries.includes(code)) set({ blockedCountries: [...g.blockedCountries, code] });
    setCountry('');
  };
  const removeCountry = (c) => set({ blockedCountries: g.blockedCountries.filter((x) => x !== c) });

  const save = async () => {
    const maxMessages = numOrNull(g.maxMessages ?? '');
    const windowSeconds = numOrNull(g.windowSeconds ?? '');
    const voiceMonthlyMinutes = numOrNull(g.voiceMonthlyMinutes ?? '');
    if (Number.isNaN(maxMessages) || Number.isNaN(windowSeconds)) { toast.error('Rate limits must be whole numbers'); return; }
    if (Number.isNaN(voiceMonthlyMinutes)) { toast.error('The voice limit must be a whole number of minutes'); return; }
    setSaving(true);
    try {
      const saved = await ws.updateGuardrails({
        maxMessages,
        windowSeconds,
        limitMessage: g.limitMessage || null,
        spamCheckEnabled: !!g.spamCheckEnabled,
        blockedCountries: g.blockedCountries,
        imagesEnabled: !!g.imagesEnabled,
        voiceMonthlyMinutes
      });
      setG(saved);
      toast.success('Guardrails saved.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader icon={<IconLock className="h-4 w-4" />} title="Rate limit per visitor"
          description="How many messages one visitor may send in a window, and the message shown when they hit it. Leave the numbers blank for the platform default." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Messages">
            <Input type="number" min="1" max="1000" value={g.maxMessages ?? ''} onChange={(e) => set({ maxMessages: e.target.value })} placeholder="e.g. 20" />
          </Field>
          <Field label="Every (seconds)">
            <Input type="number" min="1" max="3600" value={g.windowSeconds ?? ''} onChange={(e) => set({ windowSeconds: e.target.value })} placeholder="e.g. 60" />
          </Field>
          <Field label="Limit-reached message" className="sm:col-span-2">
            <Input value={g.limitMessage ?? ''} onChange={(e) => set({ limitMessage: e.target.value })} maxLength={300}
              placeholder="You’re sending messages very quickly. Please wait a moment and try again." />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Spam detection"
          description="Auto-pause a conversation that looks like spam. (Enforcement is added in a later step.)" />
        <div className="p-5">
          <Checkbox checked={!!g.spamCheckEnabled} onChange={(e) => set({ spamCheckEnabled: e.target.checked })}>
            Auto-pause conversations detected as spam
          </Checkbox>
        </div>
      </Card>

      <Card>
        <CardHeader title="Country blocking"
          description="Countries whose visitors are blocked (by IP). A VPN can bypass this, so treat it as a deterrent." />
        <div className="space-y-3 p-5">
          <div className="flex gap-2">
            <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="2-letter code, e.g. RU"
              maxLength={2} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCountry(); } }} className="w-48" />
            <Button onClick={addCountry}>Add</Button>
          </div>
          {g.blockedCountries.length === 0 ? <p className="text-[13px] text-fg-3">No countries blocked.</p> : (
            <div className="flex flex-wrap gap-2">
              {g.blockedCountries.map((c) => (
                <Badge key={c} tone="neutral">
                  <span className="mr-1">{c}</span>
                  <button type="button" onClick={() => removeCountry(c)} aria-label={`Remove ${c}`} className="text-fg-3 hover:text-fg">
                    <IconX className="inline h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Visitor image uploads"
          description="Master toggle for letting visitors attach a photo in chat." />
        <div className="p-5">
          <Checkbox checked={!!g.imagesEnabled} onChange={(e) => set({ imagesEnabled: e.target.checked })}>
            Allow visitors to upload images
          </Checkbox>
        </div>
      </Card>

      <Card>
        <CardHeader title="Voice allowance"
          description="How many minutes of voice (speech-to-speech) conversations your visitors may use each month. Leave blank for the platform default, or enter 0 for unlimited. Over the limit, voice visitors are asked to type instead." />
        <div className="p-5 sm:max-w-xs">
          <Field label="Minutes per month">
            <Input type="number" min="0" value={g.voiceMonthlyMinutes ?? ''} onChange={(e) => set({ voiceMonthlyMinutes: e.target.value })} placeholder="Platform default" />
          </Field>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button variant="primary" onClick={save} loading={saving}>Save guardrails</Button>
      </div>
    </div>
  );
}
