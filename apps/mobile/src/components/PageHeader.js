import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';

export default function PageHeader({ navigation, title, subtitle, onBack }) {
  const handleBack = onBack || (() => navigation.goBack());
  const topPad = Platform.OS === 'web'
    ? spacing.lg
    : Platform.OS === 'android'
      ? (StatusBar.currentHeight || spacing.sm)
      : spacing.sm;

  return (
    <View style={[styles.wrap, { paddingTop: topPad }]}>
      <View style={styles.titleRow}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -4
  },
  title: {
    flex: 1,
    fontSize: 26,
    fontWeight: '700',
    color: colors.primary,
    letterSpacing: -0.5
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginTop: spacing.xs,
    marginLeft: 28
  }
});
