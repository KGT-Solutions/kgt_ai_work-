import OrbLogo from '../OrbLogo';

// Shell for the Orb onboarding + login pages: the light theme, a top bar (logo +
// an optional right link), and a centred content column. No sidebar.
// props: right (node), children, maxWidth (number px | 'full', default 1200)
export default function OrbAuthShell({ right, children, maxWidth = 1200 }) {
  return (
    <div className="orb-theme orb-scrollbar min-h-screen overflow-y-auto bg-orb-base">
      <div className="mx-auto w-full px-6 sm:px-10" style={maxWidth === 'full' ? undefined : { maxWidth }}>
        <header className="flex items-center justify-between py-5">
          <OrbLogo />
          {right}
        </header>
        <main className="pb-20 pt-6">{children}</main>
      </div>
    </div>
  );
}
