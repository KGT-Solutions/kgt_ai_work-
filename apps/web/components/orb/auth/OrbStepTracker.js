import { IconCheck, cx } from '..';

// The onboarding step tracker (§9 Step tracker). props: steps [label], current (index).
export default function OrbStepTracker({ steps = [], current = 0 }) {
  return (
    <div className="mx-auto flex w-full max-w-[880px] gap-3">
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'next';
        return (
          <div key={label} className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className={cx('h-1 rounded-full', i <= current ? 'bg-orb-ink' : 'bg-orb-hairline')} />
            <div className="flex items-center gap-2">
              <span className={cx(
                'flex size-5 shrink-0 items-center justify-center rounded-full orb-micro',
                state === 'current' ? 'bg-orb-yellow text-orb-ink'
                  : state === 'done' ? 'bg-orb-ink text-orb-white'
                    : 'border border-orb-stroke bg-orb-white text-orb-ink'
              )}>
                {state === 'done' ? <IconCheck size={12} /> : i + 1}
              </span>
              <span className={cx('truncate', state === 'current' ? 'orb-small-strong text-orb-ink' : 'orb-small text-orb-tertiary')}>{label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
