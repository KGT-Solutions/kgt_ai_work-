import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Menu, MenuButton, MenuItems, MenuItem } from '@headlessui/react';

// Orb Console sidebar — implemented from Figma node 244:118 (file apkG81U1gfislOJsKjOmyG),
// to the Orb design system (see apps/web/07_Orb_Console_Design_System.md §7). Hand-built
// rail; the clinic switcher and the account row are Headless UI <Menu>s. Styled entirely
// with the `orb-*` tokens + Console text-style utilities from Phase 0.
//
// Standalone + presentational: it owns its own `active` state and ships with the Figma's
// nav as defaults, so it can be previewed in isolation and later wired to real routes.
//
// NOTE: this is a NEW component. The existing DashboardShell.js is untouched.

const cx = (...p) => p.filter(Boolean).join(' ');

// Nav groups, exactly as in the Figma design.
const NAV = [
  { items: [{ key: 'overview', label: 'Overview', icon: 'overview', href: '/overview' }] },
  {
    label: 'Build',
    items: [
      { key: 'knowledge', label: 'Knowledge', icon: 'knowledge', pill: '1 outdated', href: '/knowledge' },
      { key: 'actions', label: 'Actions', icon: 'actions' },
      { key: 'testorb', label: 'Test Orb', icon: 'testorb' }
    ]
  },
  { label: 'Install', items: [{ key: 'install', label: 'Install', icon: 'install' }] },
  {
    label: 'Results',
    items: [
      { key: 'conversations', label: 'Conversations', icon: 'conversations' },
      { key: 'tickets', label: 'Tickets', icon: 'tickets', pill: '27' },
      { key: 'leads', label: 'Leads & bookings', icon: 'leads' },
      { key: 'usage', label: 'Usage', icon: 'usage' }
    ]
  },
  {
    label: 'Settings',
    items: [
      { key: 'team', label: 'Team', icon: 'team' },
      { key: 'email', label: 'Email', icon: 'email' },
      { key: 'billing', label: 'Plan & billing', icon: 'billing' }
    ]
  }
];

const DEFAULT_WORKSPACES = [
  { id: 'sanvi', initials: 'SF', name: 'Sanvi Fertility & IVF', meta: 'Pune · 3 branches' },
  { id: 'bloom', initials: 'BL', name: 'Bloom Dental Care', meta: 'Mumbai · 1 branch' }
];
const DEFAULT_USER = { initials: 'ND', name: 'Nikita Deshpande', role: 'Marketing head' };
const ACCOUNT_ACTIONS = ['Account settings', 'Switch theme', 'Sign out'];

// Downloaded Figma assets (apps/web/public/orb-sidebar/*). Used as-is, never recoloured.
const NavIcon = ({ name }) => (
  <img src={`/orb-sidebar/ic-${name}.svg`} alt="" width={16} height={16} className="shrink-0" aria-hidden="true" />
);

// The Orb logo lockup (mark tile + "Orb" wordmark), reconstructed to the design's exact geometry.
function OrbLockup() {
  return (
    <span className="inline-flex items-center" style={{ gap: '5.635px' }}>
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

// The Orb icon mark on a white tile (status card).
function OrbMark() {
  return (
    <span className="relative block shrink-0" style={{ height: '17.984px', width: '20px' }}>
      <span className="absolute inset-0 rounded-[5.128px] bg-orb-white" />
      <img src="/orb-sidebar/mark-e1.svg" alt="" aria-hidden="true" className="absolute" style={{ height: '10.513px', width: '6.41px', left: '2.82px', top: '3.59px' }} />
      <img src="/orb-sidebar/mark-e2.svg" alt="" aria-hidden="true" className="absolute" style={{ height: '10.513px', width: '9.744px', left: '7.44px', top: '3.59px' }} />
    </span>
  );
}

function Pill({ children }) {
  return <span className="ml-auto inline-flex h-5 shrink-0 items-center rounded-[6px] bg-orb-yellow px-1.5 orb-small-medium text-orb-ink">{children}</span>;
}

function NavItem({ item, active, onSelect }) {
  const cls = cx(
    'flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left transition-colors',
    active ? 'bg-orb-white text-orb-ink shadow-orb-raised' : 'text-orb-secondary hover:bg-orb-white/60 hover:text-orb-ink'
  );
  const inner = (
    <>
      <NavIcon name={item.icon} />
      <span className="min-w-0 flex-1 truncate orb-body-strong">{item.label}</span>
      {item.pill && <Pill>{item.pill}</Pill>}
    </>
  );
  // Linked items navigate; the rest fall back to in-page selection state.
  if (item.href) {
    return <Link href={item.href} aria-current={active ? 'page' : undefined} className={cls}>{inner}</Link>;
  }
  return <button type="button" onClick={() => onSelect(item.key)} aria-current={active ? 'page' : undefined} className={cls}>{inner}</button>;
}

export default function OrbSidebar({ workspaces = DEFAULT_WORKSPACES, user = DEFAULT_USER, status }) {
  const router = useRouter();
  const pathname = router?.pathname || '';
  const [active, setActive] = useState('overview');
  const [workspace, setWorkspace] = useState(workspaces[0]);
  const [showStatus, setShowStatus] = useState(true);
  // Linked items are active by route; others by in-page selection state.
  const isActive = (item) => (item.href ? pathname === item.href || pathname.startsWith(`${item.href}/`) : active === item.key);
  const liveStatus = status || { state: 'Live', note: 'Widget seen 4 min ago on sanvifertility.in' };

  return (
    <div className="flex h-full w-[232px] flex-col border-r border-orb-hairline bg-orb-base pb-3 pl-4 pt-3.5">
      {/* Fixed top: lockup + workspace switcher — pinned, never scroll */}
      <div className="flex shrink-0 flex-col gap-3.5 pb-2 pr-3">
        {/* Lockup */}
        <div className="flex h-9 items-center pl-1">
          <OrbLockup />
        </div>

        {/* Clinic / workspace switcher — Headless UI Menu */}
        <Menu as="div" className="w-full">
          <MenuButton className="flex w-full items-center gap-2.5 rounded-[10px] bg-orb-white p-2 text-left shadow-orb-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-orb-ink orb-small-strong text-orb-white">{workspace.initials}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate orb-heading text-orb-ink">{workspace.name}</span>
              <span className="block truncate orb-small text-orb-secondary">{workspace.meta}</span>
            </span>
            <img src="/orb-sidebar/ic-chevron.svg" alt="" width={14} height={14} className="shrink-0" aria-hidden="true" />
          </MenuButton>
          <MenuItems anchor="bottom start" className="z-30 w-[var(--button-width)] rounded-[10px] bg-orb-white p-1 shadow-orb-pop [--anchor-gap:4px] focus:outline-none">
            {workspaces.map((w) => (
              <MenuItem key={w.id}>
                <button
                  type="button"
                  onClick={() => setWorkspace(w)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left data-[focus]:bg-orb-subtle"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-orb-ink orb-small-strong text-orb-white">{w.initials}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate orb-body-strong text-orb-ink">{w.name}</span>
                    <span className="block truncate orb-small text-orb-secondary">{w.meta}</span>
                  </span>
                </button>
              </MenuItem>
            ))}
          </MenuItems>
        </Menu>
      </div>

      {/* Scrollable region: nav only. Scrolls when it overflows; the fixed top
          (lockup + switcher) and fixed bottom (status + account) stay pinned. */}
      <div className="orb-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto pr-3 pt-3.5">
        <nav className="flex w-full flex-col gap-0.5" aria-label="Sidebar">
          {NAV.map((group, gi) => (
            <div key={group.label || `g${gi}`} className="flex flex-col gap-0.5">
              {group.label && <p className="px-2 pb-1.5 pt-2.5 orb-small-medium text-orb-secondary">{group.label}</p>}
              {group.items.map((item) => (
                <NavItem key={item.key} item={item} active={isActive(item)} onSelect={setActive} />
              ))}
            </div>
          ))}
        </nav>
      </div>

      {/* Fixed bottom: Orb status card + account row — pinned, never scroll */}
      <div className="flex shrink-0 flex-col gap-3.5 pr-3 pt-3.5">
        {/* Orb status card — dismissible */}
        {showStatus && (
          <div className="w-full rounded-[10px] bg-orb-white p-3 shadow-[0_0_0_1px_rgba(32,32,32,0.08)]">
            <div className="flex items-center gap-2">
              <OrbMark />
              <span className="orb-heading text-orb-ink">Orb</span>
              <span className="ml-auto flex items-center gap-1.5">
                <span className="size-1.5 rounded-[3px] bg-orb-ink" />
                <span className="orb-small-medium text-orb-secondary">{liveStatus.state}</span>
              </span>
              <button
                type="button"
                onClick={() => setShowStatus(false)}
                aria-label="Dismiss"
                className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded-md text-orb-secondary transition-colors hover:bg-orb-subtle hover:text-orb-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink"
              >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            <p className="mt-2.5 w-[180px] orb-small text-orb-secondary">{liveStatus.note}</p>
          </div>
        )}

        {/* Account row — Headless UI Menu */}
        <Menu as="div" className="relative w-full">
          <MenuButton className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-orb-white/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[12px] bg-orb-light-grey orb-micro text-orb-ink">{user.initials}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate orb-heading text-orb-ink">{user.name}</span>
              <span className="block truncate orb-small text-orb-secondary">{user.role}</span>
            </span>
            <img src="/orb-sidebar/ic-usermore.svg" alt="" width={16} height={16} className="shrink-0" aria-hidden="true" />
          </MenuButton>
          <MenuItems anchor="top start" className="z-30 w-[var(--button-width)] rounded-[10px] bg-orb-white p-1 shadow-orb-pop [--anchor-gap:4px] focus:outline-none">
            {ACCOUNT_ACTIONS.map((label) => (
              <MenuItem key={label}>
                <button type="button" className="w-full rounded-lg px-2 py-1.5 text-left orb-body text-orb-ink data-[focus]:bg-orb-subtle">{label}</button>
              </MenuItem>
            ))}
          </MenuItems>
        </Menu>
      </div>
    </div>
  );
}
