// The Orb icon mark on a dark tile — used as the chat avatar. size = px square.
export default function OrbMark({ size = 28 }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-orb-ink" style={{ width: size, height: size }}>
      <svg width={size * 0.58} height={size * 0.52} viewBox="0 0 20 18" fill="none" aria-hidden="true">
        <ellipse cx="6.5" cy="9" rx="3" ry="5.6" fill="#FFFFFF" />
        <ellipse cx="12.5" cy="9" rx="4.6" ry="5.6" fill="#FFFFFF" fillOpacity="0.55" />
      </svg>
    </span>
  );
}
