// Centered form card for the auth/onboarding steps: header (title + subtitle),
// body, and a bordered footer. props: title, subtitle, children, footer, width
export default function OrbFormCard({ title, subtitle, children, footer, width = 560 }) {
  return (
    <div className="mx-auto flex w-full flex-col overflow-hidden rounded-2xl border border-orb-hairline bg-orb-white" style={{ maxWidth: width }}>
      <div className="border-b border-orb-hairline px-7 pb-5 pt-6">
        <p className="orb-card-title text-orb-ink">{title}</p>
        {subtitle && <p className="mt-1 orb-small text-orb-secondary">{subtitle}</p>}
      </div>
      <div className="px-7 py-6">{children}</div>
      {footer && <div className="border-t border-orb-hairline px-7 py-4">{footer}</div>}
    </div>
  );
}
