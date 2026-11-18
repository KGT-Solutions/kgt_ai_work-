import { useState } from 'react';
import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react';
import OrbSidebar from './OrbSidebar';

// Orb Console shell — hosts the OrbSidebar (Figma node 244:118) responsively:
//   • desktop (lg+): a fixed 232px rail on the left (Orb §7 layout)
//   • mobile/tablet (<lg): a top bar with a hamburger that opens the rail in a
//     Headless UI <Dialog> drawer sliding in from the left.
// The light surface comes from the `.orb-theme` scope set up in Phase 0.
//
// NEW component — does not touch the existing DashboardShell.

function Hamburger(props) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#202020" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}

// A compact lockup for the mobile top bar.
function MiniLockup() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative block h-5 w-[25px]">
        <span className="absolute inset-0 rounded-[3.5px] bg-orb-ink" />
        <img src="/orb-sidebar/lockup-e1.svg" alt="" aria-hidden="true" className="absolute" style={{ height: '9.3px', width: '5.7px', left: '2.5px', top: '3.3px' }} />
        <img src="/orb-sidebar/lockup-e2.svg" alt="" aria-hidden="true" className="absolute" style={{ height: '9.3px', width: '5.7px', left: '9.7px', top: '3.3px' }} />
        <img src="/orb-sidebar/lockup-e3.svg" alt="" aria-hidden="true" className="absolute" style={{ height: '9.3px', width: '8.7px', left: '13.7px', top: '3.3px' }} />
      </span>
      <span className="font-orb-sans font-bold leading-none text-orb-ink" style={{ fontSize: '20px', letterSpacing: '-0.8px' }}>Orb</span>
    </span>
  );
}

export default function OrbShell({ children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    // Own scroll container (h-screen + overflow) so the whole page uses the thin
    // orb-scrollbar instead of the browser's default thick scrollbar.
    <div className="orb-theme orb-scrollbar h-screen w-full overflow-y-auto">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden lg:block">
        <OrbSidebar />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-orb-hairline bg-orb-base px-4 lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          className="flex size-9 items-center justify-center rounded-lg border border-orb-stroke bg-orb-white focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink"
        >
          <Hamburger />
        </button>
        <MiniLockup />
      </header>

      {/* Mobile drawer — Headless UI Dialog */}
      <Dialog open={drawerOpen} onClose={setDrawerOpen} className="relative z-40 lg:hidden">
        <DialogBackdrop
          transition
          className="fixed inset-0 bg-orb-ink/30 duration-200 ease-out data-[closed]:opacity-0"
        />
        <div className="fixed inset-0 flex">
          <DialogPanel
            transition
            className="h-full w-[232px] duration-200 ease-out data-[closed]:-translate-x-full"
          >
            <OrbSidebar />
          </DialogPanel>
        </div>
      </Dialog>

      {/* Main content area (Orb §7: main shell to the right of the 232px rail).
          Full width — pages cap their own content width as needed. */}
      <main className="lg:pl-[232px]">
        <div className="min-h-[calc(100vh-56px)] w-full bg-orb-white p-5 lg:min-h-screen lg:p-10">{children}</div>
      </main>
    </div>
  );
}
