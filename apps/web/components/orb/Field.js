// Labelled form field (§9 Text field pattern): label (Small medium) + control +
// helper (Small). Pass `helper` or `error`.
export default function Field({ label, htmlFor, helper, error, children, className = '' }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && <label htmlFor={htmlFor} className="orb-small-medium text-orb-secondary">{label}</label>}
      {children}
      {error ? <p className="orb-small text-orb-ink" role="alert">{error}</p> : helper ? <p className="orb-small text-orb-secondary">{helper}</p> : null}
    </div>
  );
}
