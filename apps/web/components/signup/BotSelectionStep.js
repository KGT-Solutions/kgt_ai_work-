import { Badge, Button, cx } from '../ui';
import { IconArrowLeft, IconArrowRight, IconCheck } from '../ui/icons';
import { BOT_PREFERENCES } from '../../lib/botPreferences';

// Signup wizard step: which AI agents to deploy. Sits between email
// verification and knowledge upload; the choice (value: 'support' | 'sales'
// | 'both') goes to the readiness audit and to /register/complete
// (Tenant.botPreference). It decides what the audit judges and how the
// knowledge is routed — one bot alone uses all of it — and can be changed
// later from the dashboard Overview.

export default function BotSelectionStep({ value, onChange, onBack, onNext }) {
  // Arrow keys move the selection, like a native radio group.
  const onKeyDown = (e) => {
    const i = BOT_PREFERENCES.findIndex((p) => p.id === value);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = BOT_PREFERENCES[(i + step + BOT_PREFERENCES.length) % BOT_PREFERENCES.length];
    onChange(next.id);
    document.getElementById(`bot-pref-${next.id}`)?.focus();
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-fg">Choose Your AI Workforce</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-fg-2">
          Select which specialized AI agents you want to deploy for your business. You can choose one or both.
        </p>
      </div>

      <div role="radiogroup" aria-label="AI agents to deploy" onKeyDown={onKeyDown} className="grid gap-4 md:grid-cols-3">
        {BOT_PREFERENCES.map((p) => {
          const selected = value === p.id;
          return (
            <button key={p.id} id={`bot-pref-${p.id}`} type="button" role="radio" aria-checked={selected} tabIndex={selected ? 0 : -1}
              onClick={() => onChange(p.id)}
              className={cx('glass relative flex h-full flex-col rounded-2xl border p-5 text-left transition duration-200 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-400/20',
                selected
                  ? 'border-brand-400/60 bg-brand-400/[0.06] shadow-[0_0_0_1px_rgba(56,189,248,0.25),0_12px_32px_-12px_rgba(56,189,248,0.45)]'
                  : 'border-white/[0.08] hover:-translate-y-0.5 hover:border-white/20')}>
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-obsidian/60 text-2xl" aria-hidden="true">{p.emoji}</span>
                <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition',
                  selected ? 'border-brand-400 bg-brand-400 text-obsidian' : 'border-white/20')}>
                  {selected && <IconCheck className="h-3 w-3" />}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-fg">{p.title}</span>
                {p.recommended && <Badge tone="green">Recommended</Badge>}
              </div>
              <span className="mt-0.5 text-xs font-medium text-fg-3">{p.tagline}</span>
              <p className="mt-3 text-[13px] leading-relaxed text-fg-2">{p.description}</p>
              <ul className="mt-4 space-y-1.5 border-t border-white/[0.06] pt-4">
                {p.points.map((point) => (
                  <li key={point} className="flex items-start gap-2 text-xs text-fg-2">
                    <IconCheck className={cx('mt-0.5 h-3.5 w-3.5 shrink-0', selected ? 'text-brand-300' : 'text-fg-3')} />{point}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-fg-3">
        {value === 'both'
          ? 'Your knowledge is split automatically: pricing and plans go to Sales, manuals and FAQs to Support, company basics to both.'
          : `Your ${value === 'sales' ? 'Sales' : 'Support'} Bot will answer from all of your knowledge. You can add the other bot later from your dashboard.`}
      </p>

      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button onClick={onBack}><IconArrowLeft className="h-4 w-4" />Back</Button>
        <Button variant="primary" onClick={onNext} disabled={!value}>Continue <IconArrowRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
