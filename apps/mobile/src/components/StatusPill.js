import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, spacing } from '../theme';

const VARIANTS = {
  success: { bg: '#E7EFE8', fg: colors.accent },
  warning: { bg: '#FBF0E1', fg: colors.warning },
  error: { bg: '#F6E6E3', fg: colors.error },
  neutral: { bg: '#EEF0F0', fg: colors.textMuted }
};

export default function StatusPill({ label, variant = 'neutral' }) {
  const v = VARIANTS[variant] || VARIANTS.neutral;
  return (
    <View style={[styles.pill, { backgroundColor: v.bg }]}>
      <Text style={[styles.text, { color: v.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontWeight: '600' }
});
