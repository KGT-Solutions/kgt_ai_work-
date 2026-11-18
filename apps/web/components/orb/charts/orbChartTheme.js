// Shared theme + tooltip for the Orb chart components (Recharts, restyled to the
// Orb Console design system — see apps/web/07_Orb_Console_Design_System.md).
// Recharts needs concrete colour values, so the orb tokens are mirrored here as
// hex; keep them in sync with tailwind.config.js `orb` + the doc §2.

export const ORB = {
  ink: '#202020',
  secondary: '#5C5C5C',
  tertiary: '#767676',
  stroke: '#909090',
  hairline: '#E8E8E8',
  lightGrey: '#DEDEDE',
  subtle: '#F6F6F6',
  white: '#FFFFFF',
  yellow: '#F2F05C',
  blue: '#5C5EF2'
};

// Axis tick text styled as Console/Small (§3.2).
export const axisTick = { fill: ORB.tertiary, fontSize: 12, fontFamily: 'Inter, system-ui, sans-serif' };

// White card tooltip (§6 Elevation · Popover). Shows every series' value for the
// hovered point. Pass a valueFormatter for units (%, ₹, etc.).
export function OrbTooltip({ active, payload, label, valueFormatter = (v) => v, labelFormatter = (l) => l }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-orb-hairline bg-orb-white px-2.5 py-1.5 shadow-orb-pop">
      {label != null && label !== '' && <p className="orb-small-strong text-orb-ink">{labelFormatter(label)}</p>}
      <div className={label != null && label !== '' ? 'mt-1 space-y-0.5' : 'space-y-0.5'}>
        {payload.map((p, i) => (
          <div key={i} className="flex items-center gap-2 orb-small text-orb-secondary">
            <span className="inline-block size-1.5 shrink-0 rounded-full" style={{ background: p.color || p.fill || ORB.ink }} />
            {p.name && <span>{p.name}</span>}
            <span className="ml-auto orb-small-strong text-orb-ink">{valueFormatter(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
