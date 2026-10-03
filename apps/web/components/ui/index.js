import { forwardRef, useId, useState } from 'react';
import { IconCheck, IconCopy, IconEye, IconEyeOff } from './icons';

// KGT AI Hub primitives. Dark-first, hairline borders, KGT blue focus.
export const cx = (...parts) => parts.filter(Boolean).join(' ');

// ── Brand
// The KGT Solutions logo (white wordmark, blue→green mark), drawn for dark
// grounds, which is every surface in this app. Split into its mark and its
// wordmark so the collapsed sidebar can show the mark alone: DashboardShell
// hides the direct <span> child (the wordmark + "AI Hub") when collapsed.
// Each instance gets its own gradient id — several logos render at once
// (mobile header, sidebar), and a shared id inside a display:none copy
// leaves the visible mark unpainted.
export function Logo({ className = '', compact = false }) {
  const gradientId = `kgt-mark-${useId().replace(/:/g, '')}`;
  return (
    <span className={cx('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 46.2 44" className="h-7 w-auto shrink-0" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="14.6427" y1="-0.843008" x2="14.6427" y2="43.9287" gradientUnits="userSpaceOnUse">
            <stop offset="0.03" stopColor="#1364D8" /><stop offset="1" stopColor="#22C55E" />
          </linearGradient>
        </defs>
        <g fill="#fff">
          <path d="M6.19405 12.8255C9.61493 12.8255 12.3881 9.95439 12.3881 6.41273C12.3881 2.87108 9.61493 0 6.19405 0C2.77317 0 0 2.87108 0 6.41273C0 9.95439 2.77317 12.8255 6.19405 12.8255Z" />
          <path d="M39.9846 12.8255C43.4055 12.8255 46.1786 9.95439 46.1786 6.41273C46.1786 2.87108 43.4055 0 39.9846 0C36.5637 0 33.7905 2.87108 33.7905 6.41273C33.7905 9.95439 36.5637 12.8255 39.9846 12.8255Z" />
          <path d="M39.9846 44.0013C43.4055 44.0013 46.1786 41.1302 46.1786 37.5885C46.1786 34.0469 43.4055 31.1758 39.9846 31.1758C36.5637 31.1758 33.7905 34.0469 33.7905 37.5885C33.7905 41.1302 36.5637 44.0013 39.9846 44.0013Z" />
          <path d="M6.19405 44.0013C9.61493 44.0013 12.3881 41.1302 12.3881 37.5885C12.3881 34.0469 9.61493 31.1758 6.19405 31.1758C2.77317 31.1758 0 34.0469 0 37.5885C0 41.1302 2.77317 44.0013 6.19405 44.0013Z" />
          <path d="M23.1906 28.4153C26.6115 28.4153 29.3847 25.5442 29.3847 22.0026C29.3847 18.4609 26.6115 15.5898 23.1906 15.5898C19.7698 15.5898 16.9966 18.4609 16.9966 22.0026C16.9966 25.5442 19.7698 28.4153 23.1906 28.4153Z" />
          <path d="M39.9846 28.4153C43.4055 28.4153 46.1786 25.5442 46.1786 22.0026C46.1786 18.4609 43.4055 15.5898 39.9846 15.5898C36.5637 15.5898 33.7905 18.4609 33.7905 22.0026C33.7905 25.5442 36.5637 28.4153 39.9846 28.4153Z" />
        </g>
        <path fill={`url(#${gradientId})`} d="M23.0873 44C19.6723 44 16.8932 41.1229 16.8932 37.5873C16.8932 37.4698 16.8932 37.3524 16.9015 37.2392C17.0378 34.6556 16.0137 32.1517 14.1224 30.4238C12.5657 28.9978 10.5505 28.2261 8.48585 28.2261C8.04401 28.2261 7.59803 28.2596 7.15619 28.3351C6.84236 28.3855 6.51614 28.4106 6.18992 28.4106C2.77906 28.4148 0 25.5377 0 22.0021C0 18.4665 2.77906 15.5894 6.19405 15.5894C6.52027 15.5894 6.84649 15.6145 7.16032 15.6649C7.60216 15.7362 8.04814 15.7739 8.48998 15.7739C10.5547 15.7739 12.5698 15.0022 14.1266 13.5762C16.0178 11.8483 17.0419 9.3402 16.9056 6.76084C16.9015 6.6476 16.8974 6.53436 16.8974 6.41273C16.8974 2.87713 19.6723 0 23.0873 0C26.5023 0 29.2813 2.87713 29.2813 6.41273C29.2813 9.94834 26.5023 12.8255 23.0873 12.8255C22.7611 12.8255 22.4349 12.8003 22.121 12.75C21.6792 12.6787 21.2332 12.6409 20.7914 12.6409C18.7267 12.6409 16.7115 13.4126 15.1548 14.8386C13.2635 16.5666 12.2394 19.0746 12.3757 21.654C12.3798 21.7672 12.384 21.8805 12.384 22.0021C12.384 22.1237 12.384 22.237 12.3757 22.3502C12.2394 24.9338 13.2635 27.4376 15.1548 29.1656C16.7115 30.5916 18.7267 31.3633 20.7914 31.3633C21.2332 31.3633 21.6792 31.3297 22.121 31.2542C22.4349 31.2039 22.7611 31.1787 23.0873 31.1787C26.5023 31.1787 29.2813 34.0559 29.2813 37.5915C29.2813 41.1271 26.5023 44.0042 23.0873 44.0042V44Z" />
      </svg>
      {!compact && (
        <span className="inline-flex items-center gap-2.5">
          <svg viewBox="59 0 80 44" className="h-7 w-auto" role="img" aria-label="KGT Solutions">
            <g fill="#fff">
              <path d="M128.21 41.2019V36.4141H129.558V43.7656L128.284 43.6099L124.172 38.81V43.7656H122.823V36.4141L124.097 36.5738L128.21 41.2019Z" />
              <path d="M71.2638 36.4534C77.6998 35.3352 77.7785 44.5796 71.5744 43.749C67.4029 43.1899 67.513 37.1043 71.2638 36.4534ZM71.767 37.6513C68.9874 38.1625 69.3962 42.8425 72.5494 42.563C75.7419 42.2795 75.2268 37.0164 71.767 37.6513Z" />
              <path d="M114.531 36.4592C120.897 35.421 120.751 44.8131 114.531 43.7309C110.564 43.0401 110.604 37.0981 114.531 36.4592ZM117.209 41.8301C119.245 39.7017 116.124 36.008 113.745 38.2282C111.366 40.4484 114.897 44.246 117.209 41.8301Z" />
              <path d="M65.0797 37.1001C64.4939 38.6734 64.0575 37.8269 63.106 37.6512C62.5045 37.5434 61.0419 37.4954 61.034 38.3819C61.0262 39.548 64.9303 39.1965 65.2369 41.1253C65.6734 43.8806 62.4848 44.216 60.5819 43.4573C59.4771 43.0181 58.8756 42.5429 60.1337 41.7322C60.8335 42.455 63.5699 43.1818 63.8727 41.9359C64.14 40.8298 61.6749 40.6581 60.9711 40.3306C58.9385 39.3802 59.3906 36.8206 61.498 36.4572C62.8583 36.2216 63.8727 36.541 65.0757 37.1041L65.0797 37.1001Z" />
              <path d="M138.818 37.0993C138.2 38.6846 137.866 37.834 137.013 37.6463C136.313 37.4946 134.127 37.4946 134.937 38.7325C135.55 39.6709 138.421 39.1997 138.908 41.0246C139.765 44.2272 134.402 44.5546 133.109 42.5061L133.876 41.7274C134.072 41.6915 134.556 42.2505 134.878 42.3823C135.723 42.7297 138.082 42.8056 137.386 41.372C136.883 40.3338 132.963 40.9887 133.439 38.0497C133.797 35.8534 137.41 36.1888 138.814 37.1033L138.818 37.0993Z" />
              <path d="M88.9843 36.4141V41.1181C88.9843 42.8791 92.6879 43.1666 92.6879 40.9464V36.4141H94.0364V41.4575C94.0364 41.6252 93.4978 42.6116 93.3366 42.7992C92.0313 44.3366 88.8034 44.113 87.9463 42.1723C87.8873 42.0445 87.6396 41.3377 87.6396 41.2858V36.4141H88.9882H88.9843Z" />
              <path d="M103.295 36.4141V37.7837H100.94V43.7696H99.5915V37.7837L97.3937 37.7079C97.1146 37.5082 97.146 36.6097 97.4881 36.4141H103.295Z" />
              <path d="M80.9047 42.4002H84.6083V43.7698H79.8117L79.5601 43.5143V36.6739C79.7724 36.3105 80.8064 36.2945 81.003 36.586C81.1052 36.7098 80.9047 36.8017 80.9047 36.8456V42.4042V42.4002Z" />
              <path d="M108.009 36.4141H106.661V43.7656H108.009V36.4141Z" />
              <path d="M71.4751 15.3576L84.4289 31.3328H76.7606L65.4957 17.2072V31.3328H59.4297V0.527344H65.4957V14.1245L76.2445 0.527344H83.4378L71.4792 15.3576H71.4751Z" />
              <path d="M100.029 14.2598H116.407V16.0214C116.407 19.104 115.75 21.8385 114.437 24.2292C113.124 26.6198 111.282 28.4903 108.912 29.8408C106.541 31.1913 103.828 31.8666 100.765 31.8666C97.907 31.8666 95.2601 31.1829 92.8361 29.8198C90.4081 28.4568 88.4755 26.5653 87.0302 24.1411C85.5849 21.7211 84.8623 18.9866 84.8623 15.9333C84.8623 12.88 85.5849 10.1455 87.0302 7.72548C88.4755 5.3055 90.4122 3.41397 92.8361 2.04671C95.2642 0.683634 97.907 0 100.765 0C104.489 0 107.718 0.981413 110.448 2.94843C113.177 4.91545 115.065 7.55352 116.101 10.871H109.688C108.734 9.28567 107.549 8.03165 106.137 7.10895C104.72 6.18626 102.932 5.72491 100.765 5.72491C98.9724 5.72491 97.333 6.17367 95.8464 7.06701C94.3599 7.96454 93.1871 9.18921 92.3365 10.741C91.4817 12.297 91.0564 14.025 91.0564 15.9333C91.0564 17.8416 91.4817 19.5695 92.3365 21.1255C93.1871 22.6815 94.3557 23.9062 95.8464 24.7995C97.333 25.6971 98.9724 26.1416 100.765 26.1416C103.106 26.1416 105.076 25.6006 106.678 24.5143C108.28 23.4281 109.358 21.9182 109.907 19.9806H100.029V14.2598Z" />
              <path d="M131.359 31.3328H125.293V6.24806H117.711V0.527344H138.899V6.24806H131.359V31.3328Z" />
            </g>
          </svg>
          <span className="border-l border-white/15 pl-2.5 text-[13px] font-medium tracking-tight text-fg-2">AI Hub</span>
        </span>
      )}
    </span>
  );
}

// ── Buttons
const BUTTON_VARIANTS = {
  primary: 'bg-gradient-to-b from-brand-300 to-brand-400 text-obsidian shadow-[0_0_0_1px_rgba(47,122,232,0.4),0_8px_24px_-8px_rgba(47,122,232,0.6)] hover:from-brand-200 hover:to-brand-300',
  secondary: 'border border-white/10 bg-white/[0.04] text-fg hover:bg-white/[0.08] hover:border-white/15',
  ghost: 'text-fg-2 hover:bg-white/[0.05] hover:text-fg',
  danger: 'border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20'
};
const BUTTON_SIZES = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-[15px] gap-2' };

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', loading = false, className = '', children, disabled, type = 'button', ...rest }, ref
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...rest}>
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
});

export function ButtonLink({ href, variant = 'secondary', size = 'md', className = '', children, ...rest }) {
  return (
    <a href={href} className={cx('inline-flex items-center justify-center rounded-lg font-medium transition duration-150',
      BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)} {...rest}>
      {children}
    </a>
  );
}

// ── Form controls
const CONTROL = 'w-full rounded-lg border border-white/10 bg-panel-2/80 px-3.5 text-sm text-fg placeholder:text-fg-3 transition ' +
  'focus:border-brand-400/60 focus:outline-none focus:ring-4 focus:ring-brand-400/10 disabled:opacity-50';

export const Input = forwardRef(function Input({ className = '', invalid, ...rest }, ref) {
  return <input ref={ref} className={cx(CONTROL, 'h-10', invalid && 'border-rose-400/60 focus:border-rose-400 focus:ring-rose-400/10', className)} {...rest} />;
});

export const Textarea = forwardRef(function Textarea({ className = '', ...rest }, ref) {
  return <textarea ref={ref} className={cx(CONTROL, 'min-h-[140px] py-2.5 leading-relaxed', className)} {...rest} />;
});

export function Select({ className = '', children, ...rest }) {
  return <select className={cx(CONTROL, 'h-10 appearance-none bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%236B7385%27 stroke-width=%272%27%3E%3Cpath d=%27M6 9l6 6 6-6%27/%3E%3C/svg%3E")] bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-10', className)} {...rest}>{children}</select>;
}

export function Field({ label, htmlFor, hint, error, className = '', children }) {
  return (
    <div className={cx('space-y-1.5', className)}>
      {label && <label htmlFor={htmlFor} className="block text-[13px] font-medium text-fg-2">{label}</label>}
      {children}
      {error ? <p className="text-xs text-rose-300" role="alert">{error}</p> : hint ? <p className="text-xs text-fg-3">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ checked, onChange, children, disabled, className = '' }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-fg-2', disabled && 'cursor-not-allowed opacity-60', className)}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-panel-2 accent-brand-400" />
      <span>{children}</span>
    </label>
  );
}

// ── Surfaces
export function Card({ className = '', children, as: Tag = 'div', ...rest }) {
  return <Tag className={cx('glass', className)} {...rest}>{children}</Tag>;
}

export function CardHeader({ title, description, action, icon }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/[0.06] px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-brand-300">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] leading-relaxed text-fg-3">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

// ── Status
const BADGE_TONES = {
  neutral: 'border-white/10 bg-white/[0.04] text-fg-2',
  blue: 'border-brand-400/25 bg-brand-400/10 text-brand-200',
  green: 'border-green-400/25 bg-green-400/10 text-green-200',
  success: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  warning: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
  danger: 'border-rose-400/25 bg-rose-400/10 text-rose-200'
};
export function Badge({ tone = 'neutral', dot = false, className = '', children }) {
  const dotColor = { success: 'bg-emerald-400', warning: 'bg-amber-400', danger: 'bg-rose-400', blue: 'bg-brand-400', green: 'bg-green-400', neutral: 'bg-fg-3' }[tone];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium', BADGE_TONES[tone], className)}>
      {dot && <span className={cx('h-1.5 w-1.5 rounded-full', dotColor, tone === 'success' && 'animate-pulse-dot')} />}
      {children}
    </span>
  );
}

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cx('animate-spin', className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon, title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      {icon && <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-fg-3">{icon}</span>}
      <p className="text-sm font-medium text-fg">{title}</p>
      {children && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-fg-3">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx('rounded-md px-3 py-1.5 text-[13px] font-medium transition',
            value === o.value ? 'bg-white/[0.09] text-fg shadow-sm' : 'text-fg-3 hover:text-fg-2')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Copy & secret fields
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      return true;
    } catch {
      return false; // clipboard blocked — the value stays selectable
    }
  };
  return [copied, copy];
}

export function CopyButton({ value, className = '', label = 'Copy' }) {
  const [copied, copy] = useCopy();
  return (
    <Button size="sm" variant="secondary" onClick={() => copy(value)} className={className} aria-label={copied ? 'Copied' : label}>
      {copied ? <IconCheck className="h-3.5 w-3.5 text-emerald-300" /> : <IconCopy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

// A secret shown masked by default, with reveal and copy. Only ever given a
// value the browser legitimately holds (a key issued this session); stored
// keys are hashes on the server and can't be revealed.
export function SecretField({ value, label, masked: startMasked = true }) {
  const [masked, setMasked] = useState(startMasked);
  const shown = masked ? `${value.slice(0, 9)}${'•'.repeat(24)}${value.slice(-4)}` : value;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-obsidian/60 py-1.5 pl-3 pr-1.5">
      <code className="min-w-0 flex-1 truncate text-[13px] text-brand-100" aria-label={label}>{shown}</code>
      <Button size="sm" variant="ghost" onClick={() => setMasked((m) => !m)} aria-label={masked ? 'Reveal' : 'Hide'}>
        {masked ? <IconEye className="h-3.5 w-3.5" /> : <IconEyeOff className="h-3.5 w-3.5" />}
      </Button>
      <CopyButton value={value} />
    </div>
  );
}

export function CodeBlock({ code, filename }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-obsidian/80">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
        <span className="font-mono text-[11px] text-fg-3">{filename}</span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed text-fg-2"><code>{code}</code></pre>
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={cx('skeleton', className)} />;
}
