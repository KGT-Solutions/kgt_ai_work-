// Text wordmark — the console ships no logo images.
export default function BrandHeader({ role, actions }) {
  return (
    <header className="admin-brand-header">
      <span className="admin-brand-logo-fallback">KGT AI Hub</span>
      <div className="admin-brand-header-end">
        {role ? <span className="admin-brand-role">{role}</span> : null}
        {actions}
      </div>
    </header>
  );
}

export function BrandMobileMark() {
  return <span className="admin-mobile-logo-fallback">KGT AI Hub</span>;
}
