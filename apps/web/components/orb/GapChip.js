// A knowledge-gap chip (Orb §8 Console/Gap chip): a gap always shown next to a
// way to fill it. Outlined, with a small "+" affordance.
export default function GapChip({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-orb-stroke bg-orb-white px-2.5 orb-small-medium text-orb-secondary transition-colors hover:border-orb-ink hover:text-orb-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-orb-ink"
    >
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
      {children}
    </button>
  );
}
