import { useState } from 'react';
import { Button, Pill, Toggle, ScoreBar } from '..';
import { OrbFormCard } from '../auth';

// Step 4 (Figma 0E): the two bots' readiness scores + what to add.
const BOTS = [
  {
    name: 'Sales', on: true, score: 71, status: 'Moderate',
    desc: 'New visitors on your public pages: treatments, prices, booking.',
    gapNote: 'Test prices are missing: ERA and semen analysis aren’t in Fees and packages.',
    gaps: [{ title: 'Test prices', desc: 'ERA and semen analysis' }]
  },
  {
    name: 'Support', on: true, score: 64, status: 'Moderate',
    desc: 'Patients on pages behind your login: reports, appointments, policies.',
    gapNote: 'Insurance and Sunday hours aren’t in your knowledge, and patients often ask about both.',
    gaps: [
      { title: 'Insurance and TPA cover', desc: 'Which insurers and TPAs you accept' },
      { title: 'Sunday branch hours', desc: 'Which branches open on Sunday, and when' }
    ]
  }
];

function BotPanel({ bot }) {
  const [on, setOn] = useState(bot.on);
  return (
    <div className="flex flex-col rounded-xl border border-orb-hairline p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="orb-card-title text-orb-ink">{bot.name}</p>
        <Toggle checked={on} onChange={() => setOn(!on)} ariaLabel={bot.name} />
      </div>
      <p className="mt-1 orb-small text-orb-secondary">{bot.desc}</p>
      <div className="mt-3 flex items-end gap-2">
        <span className="flex items-baseline gap-1"><span className="orb-figure text-orb-ink">{bot.score}</span><span className="orb-small text-orb-tertiary">/100</span></span>
        <Pill tone="neutral" className="mb-1.5">{bot.status}</Pill>
      </div>
      <ScoreBar value={bot.score} max={100} marker={{ at: 80, label: 'Ready 80' }} />
      <p className="mt-3 orb-small text-orb-secondary">{bot.gapNote}</p>
      <p className="mt-3 orb-small-medium text-orb-secondary">What to add</p>
      <div className="mt-2 flex flex-col gap-2">
        {bot.gaps.map((g) => (
          <div key={g.title} className="flex items-center justify-between gap-3 rounded-lg bg-orb-subtle px-3 py-2">
            <div className="min-w-0">
              <p className="truncate orb-body-strong text-orb-ink">{g.title}</p>
              <p className="truncate orb-small text-orb-secondary">{g.desc}</p>
            </div>
            <Button>Add</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TrainingStep({ onBack, onContinue }) {
  return (
    <OrbFormCard
      width={880}
      title="Is Orb ready for patients?"
      subtitle="Orb answers through two bots that share your knowledge. Each gets a score. Orb’s readiness is the lower score of the bots you switch on. Checked 6 Oct, 3:12 pm."
      footer={(
        <div className="flex items-center justify-between">
          <Button onClick={onBack}>Back</Button>
          <Button variant="primary" size="md" onClick={onContinue}>Continue</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {BOTS.map((b) => <BotPanel key={b.name} bot={b} />)}
        </div>
        <div className="rounded-[10px] bg-orb-subtle px-3.5 py-3">
          <p className="orb-small-strong text-orb-ink">Orb readiness: 64 · Moderate (the lower of the two)</p>
          <p className="mt-0.5 orb-small text-orb-secondary">Ready is 80. You can continue now: questions Orb can’t answer become tickets for your team, and you can add knowledge any time. “Add” takes you back to Step 3 with nothing lost.</p>
        </div>
      </div>
    </OrbFormCard>
  );
}
