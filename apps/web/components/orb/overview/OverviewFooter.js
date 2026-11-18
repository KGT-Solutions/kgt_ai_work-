// Slim summary bar at the bottom of the Overview (§10 formats: ₹ grouping, etc.).
// props: conversations, perConversation, planUsedPct, planLabel, dataNote
export default function OverviewFooter({ conversations, perConversation, planUsedPct, planLabel, dataNote }) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-orb-hairline pt-4">
      <span className="flex items-center gap-1.5 orb-small text-orb-secondary">
        <span className="orb-body-strong text-orb-ink">{conversations}</span> conversations
      </span>
      <span className="orb-small text-orb-secondary">{perConversation}</span>
      <span className="flex items-center gap-2 orb-small text-orb-secondary">
        Plan
        <span className="h-1.5 w-24 overflow-hidden rounded-full bg-orb-hairline">
          <span className="block h-full rounded-full bg-orb-ink" style={{ width: `${Math.max(0, Math.min(100, planUsedPct))}%` }} />
        </span>
        <span className="orb-body-strong text-orb-ink">{planLabel}</span> used
      </span>
      <span className="ml-auto flex items-center gap-2 orb-small text-orb-secondary">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.33" aria-hidden="true">
          <rect x="3" y="7" width="10" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" strokeLinecap="round" />
        </svg>
        {dataNote}
      </span>
    </div>
  );
}
