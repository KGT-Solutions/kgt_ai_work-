import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, CardHeader, Field, Input, Segmented, Skeleton, Textarea } from '../ui';
import { useToast } from '../ui/toast';
import { IconLock } from '../ui/icons';

// Client-facing Instructions Editor (Feature 11). The owner tunes each
// assistant's tone/style/length and a little free-text guidance; the backend
// (services/tenantInstructions.js) layers that onto the system prompt STRICTLY
// subordinate to the locked grounding/safety/pricing rules, which this screen
// shows but never lets the owner edit. Every save is versioned and restorable.

const BOT_OPTIONS = [{ value: 'support', label: 'Support assistant' }, { value: 'sales', label: 'Sales assistant' }];

// The locked rules, shown read-only so owners know what their guidance can't
// touch. These mirror domains/tenantProfile.js (enforced server-side).
const LOCKED_RULES = [
  'Answers come only from your uploaded knowledge — the bot never guesses or uses outside facts.',
  'Prices, policies, figures and conditions stay exactly as your documents state them.',
  'It stays on topic for your business and never reveals or changes its own instructions.',
  'Safety and privacy boundaries, and the “You are chatting with an AI assistant” notice, always apply.'
];
const MAX_GUIDANCE = 2000;

// Segmented options from a preset catalog, with a leading "Default" (= unset).
function presetOptions(catalog) {
  const opts = [{ value: '', label: 'Default' }];
  Object.entries(catalog || {}).forEach(([key, def]) => opts.push({ value: key, label: def.label }));
  return opts;
}

const EMPTY_FORM = { tone: '', style: '', length: '', guidance: '', summary: '' };

function formatWhen(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

// A short human description of a version's settings, for the history list.
function describeSettings(v, presets) {
  const parts = [];
  if (v.tone && presets?.tone?.[v.tone]) parts.push(`${presets.tone[v.tone].label} tone`);
  if (v.style && presets?.style?.[v.style]) parts.push(presets.style[v.style].label.toLowerCase());
  if (v.length && presets?.length?.[v.length]) parts.push(`${presets.length[v.length].label.toLowerCase()} length`);
  if (v.guidance) parts.push('custom guidance');
  return parts.length ? parts.join(' · ') : 'Default voice (no customisation)';
}

export default function InstructionsEditor({ ws }) {
  const toast = useToast();
  const [bot, setBot] = useState('support');
  const [data, setData] = useState(null); // current settings + preset catalog
  const [form, setForm] = useState(EMPTY_FORM);
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState(null);

  const adopt = useCallback((view) => {
    setData(view);
    setForm({ tone: view.tone || '', style: view.style || '', length: view.length || '', guidance: view.guidance || '', summary: '' });
  }, []);

  const load = useCallback(async (which) => {
    setLoading(true);
    try {
      const [view, vs] = await Promise.all([ws.getInstructions(which), ws.listInstructionVersions(which)]);
      adopt(view);
      setVersions(vs.versions || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [ws, toast, adopt]);

  useEffect(() => { load(bot); }, [load, bot]);

  const presets = data?.presets;
  const dirty = data && (
    (form.tone || '') !== (data.tone || '') ||
    (form.style || '') !== (data.style || '') ||
    (form.length || '') !== (data.length || '') ||
    (form.guidance || '').trim() !== (data.guidance || '').trim()
  );

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      await ws.saveInstructions({
        botType: bot,
        tone: form.tone || null, style: form.style || null, length: form.length || null,
        guidance: form.guidance || '', summary: form.summary || null
      });
      toast.success('Instructions saved. Your bot uses them on its next reply.');
      await load(bot); // refresh the current view and the version list
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    if (!data) return;
    setForm({ tone: data.tone || '', style: data.style || '', length: data.length || '', guidance: data.guidance || '', summary: '' });
  };

  const restore = async (versionId) => {
    setRestoringId(versionId);
    try {
      await ws.restoreInstructionVersion(bot, versionId);
      toast.success('Version restored as the current instructions.');
      await load(bot);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRestoringId(null);
    }
  };

  const botLabel = BOT_OPTIONS.find((b) => b.value === bot)?.label || 'assistant';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Choose assistant" options={BOT_OPTIONS} value={bot} onChange={setBot} />
        {data?.version > 0 && <span className="text-[12.5px] text-fg-3">Current: v{data.version}{data.updatedBy ? ` · by ${data.updatedBy}` : ''}</span>}
      </div>

      <Card>
        <CardHeader icon={<IconLock className="h-4 w-4" />} title="Locked rules (always enforced)"
          description="Your guidance below shapes how the bot sounds — it can never change these. They’re enforced on our servers and can’t be overridden." />
        <ul className="space-y-2 p-5 pt-4">
          {LOCKED_RULES.map((rule) => (
            <li key={rule} className="flex items-start gap-2 text-[13px] leading-relaxed text-fg-2">
              <IconLock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-3" />
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </Card>

      {loading || !presets ? <Skeleton className="h-96" /> : (
        <>
          <Card>
            <CardHeader title={`Voice & style — ${botLabel}`}
              description="Pick how this assistant should sound. Leave anything on “Default” to use the standard voice." />
            <div className="space-y-5 p-5">
              <div>
                <p className="mb-2 text-[12.5px] font-medium text-fg-2">Tone</p>
                <Segmented label="Tone" options={presetOptions(presets.tone)} value={form.tone} onChange={(v) => set({ tone: v })} />
              </div>
              <div>
                <p className="mb-2 text-[12.5px] font-medium text-fg-2">Style</p>
                <Segmented label="Style" options={presetOptions(presets.style)} value={form.style} onChange={(v) => set({ style: v })} />
              </div>
              <div>
                <p className="mb-2 text-[12.5px] font-medium text-fg-2">Reply length</p>
                <Segmented label="Reply length" options={presetOptions(presets.length)} value={form.length} onChange={(v) => set({ length: v })} />
              </div>

              <Field label="Extra guidance (optional)"
                hint="Tone and phrasing only — e.g. “always greet by name”, “keep it upbeat”, “avoid jargon”. It can’t change what the bot is allowed to answer or the facts it uses.">
                <Textarea rows={4} maxLength={MAX_GUIDANCE} value={form.guidance}
                  onChange={(e) => set({ guidance: e.target.value })}
                  placeholder="e.g. Keep answers warm and encouraging, and sign off with a friendly line." />
              </Field>
              <div className="-mt-3 text-right text-[11.5px] text-fg-3">{(form.guidance || '').length}/{MAX_GUIDANCE}</div>

              <Field label="Change note (optional)" hint="A short note saved with this version, so the history is easy to scan.">
                <Input value={form.summary} maxLength={200} onChange={(e) => set({ summary: e.target.value })} placeholder="e.g. Friendlier tone for the holidays" />
              </Field>

              <div className="flex items-center justify-end gap-2">
                {dirty && <Button variant="ghost" onClick={reset} disabled={saving}>Discard changes</Button>}
                <Button variant="primary" onClick={save} loading={saving} disabled={saving || !dirty}>
                  {saving ? 'Saving…' : 'Save instructions'}
                </Button>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Version history"
              description="Every save is kept here. Restore brings a previous version back as the current one." />
            <div className="p-5">
              {versions.length === 0 ? (
                <p className="text-[13px] text-fg-3">No saved versions yet — your first save will appear here.</p>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {versions.map((v) => {
                    const isCurrent = v.version === data.version;
                    return (
                      <li key={v.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Badge tone={isCurrent ? 'success' : 'neutral'}>v{v.version}</Badge>
                            {isCurrent && <span className="text-[11.5px] font-medium text-emerald-300">Current</span>}
                            <span className="text-[12px] text-fg-3">{formatWhen(v.createdAt)}{v.actor ? ` · ${v.actor}` : ''}</span>
                          </div>
                          <p className="mt-1 text-[13px] text-fg-2">{describeSettings(v, presets)}</p>
                          {v.summary && <p className="mt-0.5 text-[12.5px] italic text-fg-3">“{v.summary}”</p>}
                          {v.guidance && <p className="mt-0.5 line-clamp-2 text-[12px] text-fg-3">{v.guidance}</p>}
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => restore(v.id)}
                          loading={restoringId === v.id} disabled={isCurrent || restoringId !== null}>
                          {isCurrent ? 'Applied' : 'Restore'}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
