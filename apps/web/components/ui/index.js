import { forwardRef, useState } from 'react';
import { IconCheck, IconCopy, IconEye, IconEyeOff } from './icons';

// KGT AI Hub primitives. Dark-first, hairline borders, cyan focus.
export const cx = (...parts) => parts.filter(Boolean).join(' ');

// ── Brand
export function Logo({ className = '', compact = false }) {
  return (
    <span className={cx('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-hidden="true">
        <defs>
          <linearGradient id="kgt-logo" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22D3EE" /><stop offset="1" stopColor="#A78BFA" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="#12151D" stroke="rgba(255,255,255,0.08)" />
        <path d="M10 8v16M10 16l8-8M10 16l8 8" stroke="url(#kgt-logo)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="23.5" cy="16" r="2.5" fill="#22D3EE" />
      </svg>
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight text-fg">
          KGT <span className="text-fg-2">AI Hub</span>
        </span>
      )}
    </span>
  );
}

// ── Buttons
const BUTTON_VARIANTS = {
  primary: 'bg-gradient-to-b from-cyan-300 to-cyan-400 text-obsidian shadow-[0_0_0_1px_rgba(34,211,238,0.4),0_8px_24px_-8px_rgba(34,211,238,0.6)] hover:from-cyan-200 hover:to-cyan-300',
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
  'focus:border-cyan-400/60 focus:outline-none focus:ring-4 focus:ring-cyan-400/10 disabled:opacity-50';

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
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-white/20 bg-panel-2 accent-cyan-400" />
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
        {icon && <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-cyan-300">{icon}</span>}
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
  cyan: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200',
  violet: 'border-violet-400/25 bg-violet-400/10 text-violet-200',
  success: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  warning: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
  danger: 'border-rose-400/25 bg-rose-400/10 text-rose-200'
};
export function Badge({ tone = 'neutral', dot = false, className = '', children }) {
  const dotColor = { success: 'bg-emerald-400', warning: 'bg-amber-400', danger: 'bg-rose-400', cyan: 'bg-cyan-400', violet: 'bg-violet-400', neutral: 'bg-fg-3' }[tone];
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
      <code className="min-w-0 flex-1 truncate text-[13px] text-cyan-100" aria-label={label}>{shown}</code>
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
