import { cx } from './util';

// The Orb logo lockup (mark tile + "Orb" wordmark), reusing the downloaded
// Figma assets. Used in the auth/onboarding top bar.
export default function OrbLogo({ className = '' }) {
  return (
    <span className={cx('inline-flex items-center', className)} style={{ gap: '5.635px' }}>
      <span className="relative block" style={{ height: '20.126px', width: '31.429px' }}>
        <span className="absolute inset-0 rounded-[4.365px] bg-orb-ink" />
        <img src="/orb-sidebar/lockup-e1.svg" alt="" aria-hidden="true" className="absolute" style={{ height: '11.746px', width: '7.222px', left: '3.1px', top: '4.21px' }} />
        <img src="/orb-sidebar/lockup-e2.svg" alt="" aria-hidden="true" className="absolute" style={{ height: '11.746px', width: '7.222px', left: '12.22px', top: '4.21px' }} />
        <img src="/orb-sidebar/lockup-e3.svg" alt="" aria-hidden="true" className="absolute" style={{ height: '11.746px', width: '10.953px', left: '17.3px', top: '4.21px' }} />
      </span>
      <span className="font-orb-sans font-bold leading-none text-orb-ink" style={{ fontSize: '25.224px', letterSpacing: '-1.009px' }}>Orb</span>
    </span>
  );
}
