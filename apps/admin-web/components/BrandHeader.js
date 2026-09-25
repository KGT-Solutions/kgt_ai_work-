function showTextFallback(e) {
  e.currentTarget.style.display = 'none';
  const fallback = e.currentTarget.nextElementSibling;
  if (fallback) fallback.hidden = false;
}

export default function BrandHeader({ role, actions }) {
  return (
    <header className="admin-brand-header">
      <img
        src="/brand/wordmark-color.png"
        alt="FLATBRIZ"
        className="admin-brand-logo"
        onError={showTextFallback}
      />
      <span className="admin-brand-logo-fallback" hidden>FLATBRIZ</span>
      <div className="admin-brand-header-end">
        {role ? <span className="admin-brand-role">{role}</span> : null}
        {actions}
      </div>
    </header>
  );
}

export function BrandMobileMark() {
  return (
    <>
      <img
        src="/brand/icon-color.png"
        alt="FLATBRIZ"
        className="admin-mobile-logo"
        onError={showTextFallback}
      />
      <span className="admin-mobile-logo-fallback" hidden>FLATBRIZ</span>
    </>
  );
}
