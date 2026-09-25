import { colors, radius } from '../lib/theme';

/** Single shimmer block — use to compose page skeletons */
export function SkeletonBlock({ width = '100%', height = 16, radius: r = radius.sm, style }) {
  return (
    <div
      className="admin-skeleton"
      style={{
        width,
        height,
        borderRadius: r,
        ...style
      }}
      aria-hidden
    />
  );
}

export function SkeletonCard({ lines = 3, style }) {
  return (
    <div style={{ ...card, ...style }}>
      <SkeletonBlock width="40%" height={14} style={{ marginBottom: 14 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock
          key={i}
          width={i === lines - 1 ? '65%' : '100%'}
          height={12}
          style={{ marginBottom: i === lines - 1 ? 0 : 10 }}
        />
      ))}
    </div>
  );
}

export function SkeletonStatGrid({ count = 4 }) {
  return (
    <div className="admin-stat-grid" style={{ display: 'grid', gap: 16, marginBottom: 24 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={statCard}>
          <SkeletonBlock width="55%" height={12} style={{ marginBottom: 14 }} />
          <SkeletonBlock width="40%" height={28} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, cols = 4 }) {
  return (
    <div style={card}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12, marginBottom: 16 }}>
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonBlock key={`h-${i}`} height={12} width="70%" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 12,
            marginBottom: 12
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <SkeletonBlock key={c} height={14} width={c === 0 ? '80%' : '60%'} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonFlatGrid({ count = 12 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} height={88} radius={radius.md} />
      ))}
    </div>
  );
}

export function SkeletonForm() {
  return (
    <div style={card}>
      <SkeletonBlock width="45%" height={18} style={{ marginBottom: 20 }} />
      <SkeletonBlock height={42} style={{ marginBottom: 12 }} />
      <SkeletonBlock height={42} style={{ marginBottom: 12 }} />
      <SkeletonBlock width="35%" height={40} radius={radius.sm} />
    </div>
  );
}

export function PageSkeleton({ variant = 'dashboard' }) {
  if (variant === 'flats') {
    return (
      <div>
        <SkeletonForm />
        <div style={{ marginTop: 24 }}>
          <SkeletonBlock width="20%" height={16} style={{ marginBottom: 14 }} />
          <SkeletonFlatGrid />
        </div>
      </div>
    );
  }
  if (variant === 'table') {
    return (
      <div>
        <SkeletonBlock width="30%" height={20} style={{ marginBottom: 18 }} />
        <SkeletonTable />
      </div>
    );
  }
  if (variant === 'list') {
    return (
      <div>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard lines={2} />
      </div>
    );
  }
  // dashboard default
  return (
    <div>
      <SkeletonBlock width="28%" height={18} style={{ marginBottom: 20 }} />
      <SkeletonStatGrid />
      <SkeletonCard lines={4} />
    </div>
  );
}

const card = {
  background: colors.card,
  padding: 20,
  borderRadius: radius.lg,
  border: `1px solid ${colors.border}`,
  marginBottom: 16
};

const statCard = {
  background: colors.card,
  borderRadius: radius.lg,
  padding: 20,
  border: `1px solid ${colors.border}`
};
