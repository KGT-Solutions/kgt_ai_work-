import { Button, Pill, cx } from '..';
import { OrbFormCard } from '../auth';
import { botPreferenceLabel } from '../../../lib/botPreferences';
import { useCompleteRegistration, buildCompletePayload, botPreferenceFrom } from '../../../lib/onboarding';

// Step 5 (Figma 0F): review summary + create. The Create button fires the real
// POST /register/complete via useCompleteRegistration; on success the parent
// signs the client in and routes to /testorb.
const NEXT = [
  { t: 'Test Orb', d: 'Ask a few real patient questions. Test chats don’t count in your results.' },
  { t: 'Install', d: 'Paste one snippet on your site. Orb shows Live after the first visitor chat.' }
];

export default function ReviewStep({ account, verification, company, bots, entries, onBack, onComplete }) {
  const complete = useCompleteRegistration();

  const byCat = (id) => entries.filter((e) => e.category === id).length;
  const rows = [
    ['Company', company.companyName || '—'],
    ['Your name', company.contactName || '—'],
    ['Industry', company.industryLabel || '—'],
    ['Sign-in email', account.email || '—'],
    ['Bots switched on', botPreferenceLabel(botPreferenceFrom(bots))],
    ['Knowledge', `${entries.length} entries · Overview ${byCat('CORE_OVERVIEW')}, FAQ ${byCat('FAQ')}, Policies & pricing ${byCat('CUSTOM_POLICY')}`]
  ];

  const create = async () => {
    try {
      const payload = buildCompletePayload({ account, verification, company, bots, entries });
      const data = await complete.mutateAsync(payload);
      onComplete(data);
    } catch {
      /* error shown below (e.g. 403 EMAIL_NOT_VERIFIED, 409 account exists) */
    }
  };

  return (
    <OrbFormCard
      width={880}
      title="Review and create"
      subtitle="Check the details, then create your workspace. Orb isn’t on your site until you install it."
      footer={(
        <div className="flex items-center justify-between">
          <Button onClick={onBack} disabled={complete.isPending}>Back</Button>
          <Button variant="primary" size="md" onClick={create} disabled={complete.isPending || !entries.length}>
            {complete.isPending ? 'Creating…' : 'Create workspace & test Orb'}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="overflow-hidden rounded-xl border border-orb-hairline">
          {rows.map(([label, value], i) => (
            <div key={label} className={cx('grid grid-cols-[180px_1fr] gap-4 px-4 py-3', i > 0 && 'border-t border-orb-hairline')}>
              <span className="orb-small text-orb-secondary">{label}</span>
              <span className="orb-body text-orb-ink">{value}</span>
            </div>
          ))}
        </div>

        {complete.isError && (
          <div className="flex items-start gap-3 rounded-[10px] bg-orb-subtle px-3.5 py-3">
            <Pill tone="yellow">Couldn’t create</Pill>
            <p className="orb-small text-red-600">{complete.error.message}</p>
          </div>
        )}

        <div>
          <p className="mb-2 orb-small-medium text-orb-secondary">What’s next</p>
          <ol className="flex flex-col gap-3">
            {NEXT.map((n, i) => (
              <li key={n.t} className="flex gap-3">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-orb-stroke orb-micro text-orb-ink">{i + 1}</span>
                <div>
                  <p className="orb-body-strong text-orb-ink">{n.t}</p>
                  <p className="orb-small text-orb-secondary">{n.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </OrbFormCard>
  );
}
