import { useEffect, useRef } from 'react';
import { Button, Pill, Toggle, ScoreBar } from '..';
import { OrbFormCard } from '../auth';
import { usePreflightAudit, entryToApiPage, botPreferenceFrom } from '../../../lib/onboarding';

// Step 4 (Figma 0E): which bots to switch on + their readiness scores.
// The toggles drive Tenant.botPreference; the readiness check runs the real
// preflight audit over exactly the entries added in step 3.
const BOT_META = {
  sales: { name: 'Sales', desc: 'New visitors on your public pages: treatments, prices, booking.' },
  support: { name: 'Support', desc: 'Patients on pages behind your login: reports, appointments, policies.' }
};
const statusFor = (score) => (score == null ? 'Not checked' : score >= 80 ? 'Ready' : score >= 50 ? 'Moderate' : 'Low');

function BotPanel({ bot, on, onToggle, score }) {
  const meta = BOT_META[bot];
  return (
    <div className="flex flex-col rounded-xl border border-orb-hairline p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="orb-card-title text-orb-ink">{meta.name}</p>
        <Toggle checked={on} onChange={onToggle} ariaLabel={meta.name} />
      </div>
      <p className="mt-1 orb-small text-orb-secondary">{meta.desc}</p>
      <div className="mt-3 flex items-end gap-2">
        <span className="flex items-baseline gap-1"><span className="orb-figure text-orb-ink">{score ?? '—'}</span><span className="orb-small text-orb-tertiary">/100</span></span>
        <Pill tone="neutral" className="mb-1.5">{statusFor(score)}</Pill>
      </div>
      <ScoreBar value={score ?? 0} max={100} marker={{ at: 80, label: 'Ready 80' }} />
    </div>
  );
}

export default function TrainingStep({ bots, setBots, company, entries, onBack, onContinue }) {
  const audit = usePreflightAudit();
  const toggle = (bot) => () => setBots((b) => ({ ...b, [bot]: !b[bot] }));

  // Run the readiness check once on arrival (best-effort; a failure — e.g. no
  // LLM key — just leaves the scores blank, it never blocks Continue).
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !entries.length) return;
    ran.current = true;
    const pages = entries.map(entryToApiPage).filter((p) => p.title && p.content);
    if (!pages.length) return;
    audit.mutate({
      companyName: company.companyName?.trim(),
      industryLabel: company.industryLabel,
      botPreference: botPreferenceFrom(bots),
      pages
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const report = audit.data;
  const scoreOf = (bot) => report?.bots?.[bot]?.score ?? null;
  const onScores = ['support', 'sales'].filter((b) => bots[b]).map((b) => scoreOf(b)).filter((s) => s != null);
  const orbReadiness = onScores.length ? Math.min(...onScores) : null;

  return (
    <OrbFormCard
      width={880}
      title="Is Orb ready for patients?"
      subtitle="Orb answers through two bots that share your knowledge. Switch on the ones you want; Orb’s readiness is the lower score of the bots you switch on."
      footer={(
        <div className="flex items-center justify-between">
          <Button onClick={onBack}>Back</Button>
          <Button variant="primary" size="md" onClick={onContinue}>Continue</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BotPanel bot="sales" on={bots.sales} onToggle={toggle('sales')} score={scoreOf('sales')} />
          <BotPanel bot="support" on={bots.support} onToggle={toggle('support')} score={scoreOf('support')} />
        </div>
        <div className="rounded-[10px] bg-orb-subtle px-3.5 py-3">
          {audit.isPending ? (
            <p className="orb-small-strong text-orb-ink">Checking readiness…</p>
          ) : audit.isError ? (
            <>
              <p className="orb-small-strong text-orb-ink">Couldn’t run the readiness check right now</p>
              <p className="mt-0.5 orb-small text-orb-secondary">{audit.error.message} You can still continue — Orb re-checks after launch.</p>
            </>
          ) : (
            <>
              <p className="orb-small-strong text-orb-ink">
                {orbReadiness != null ? `Orb readiness: ${orbReadiness} · ${statusFor(orbReadiness)} (the lower of the bots you switch on)` : 'Readiness runs after launch'}
              </p>
              <p className="mt-0.5 orb-small text-orb-secondary">Ready is 80. You can continue now: questions Orb can’t answer become tickets for your team, and you can add knowledge any time.</p>
            </>
          )}
        </div>
      </div>
    </OrbFormCard>
  );
}
