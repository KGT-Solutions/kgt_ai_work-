import { cx } from './util';

// Status / category pill (Orb design system §8 + pill tone table). Colour is
// reserved for state: Yellow = needs your team, Tint = Orb handled it,
// Blue = booked, Neutral = informational, Outline = unresolved/draft.
const TONES = {
  yellow: 'bg-orb-yellow text-orb-ink',
  tint: 'bg-orb-blue-tint text-orb-ink',
  blue: 'bg-orb-blue text-orb-white',
  neutral: 'border border-orb-hairline bg-orb-subtle text-orb-secondary',
  outline: 'border border-orb-stroke text-orb-secondary'
};

export default function Pill({ tone = 'neutral', children, className = '' }) {
  return (
    <span className={cx('inline-flex h-[22px] shrink-0 items-center rounded-[6px] px-1.5 orb-small-medium', TONES[tone], className)}>
      {children}
    </span>
  );
}
