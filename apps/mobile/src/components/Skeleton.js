import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../theme';

export function SkeletonBlock({ width = '100%', height = 14, style, radius: r = radius.sm }) {
  return (
    <View
      style={[
        styles.block,
        { width, height, borderRadius: r },
        style
      ]}
    />
  );
}

export function SkeletonCard({ lines = 3, style }) {
  return (
    <View style={[styles.card, style]}>
      <SkeletonBlock width="42%" height={12} style={{ marginBottom: 12 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock
          key={i}
          width={i === lines - 1 ? '70%' : '100%'}
          height={12}
          style={{ marginBottom: i === lines - 1 ? 0 : 8 }}
        />
      ))}
    </View>
  );
}

export function SkeletonList({ count = 5 }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={i % 2 === 0 ? 3 : 2} />
      ))}
    </View>
  );
}

export function PageSkeleton({ variant = 'list' }) {
  if (variant === 'form') {
    return (
      <View style={styles.list}>
        <SkeletonBlock width="50%" height={22} style={{ marginBottom: 16 }} />
        <SkeletonBlock height={48} radius={radius.md} style={{ marginBottom: 12 }} />
        <SkeletonBlock height={48} radius={radius.md} style={{ marginBottom: 12 }} />
        <SkeletonBlock width="40%" height={44} radius={radius.sm} />
      </View>
    );
  }
  return <SkeletonList count={variant === 'home' ? 3 : 5} />;
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.track,
    overflow: 'hidden'
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border
  },
  list: {
    paddingVertical: spacing.sm
  }
});
