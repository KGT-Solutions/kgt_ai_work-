// Page-level banner (§8 Console/Banner). Icon tile + title/body + optional action.
// props: icon, title, body, action, tone ('info' default)
export default function Banner({ icon, title, body, action }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-orb-subtle px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
      {icon && <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-orb-yellow text-orb-ink">{icon}</span>}
      <p className="min-w-0 flex-1 orb-body text-orb-secondary">
        {title && <span className="orb-body-strong text-orb-ink">{title} </span>}{body}
      </p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
