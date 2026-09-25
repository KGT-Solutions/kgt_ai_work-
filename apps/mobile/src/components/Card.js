import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, radius, spacing, shadow } from '../theme';

export default function Card({ children, style, dark }) {
  return <View style={[styles.card, dark && styles.dark, !dark && shadow.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md
  },
  dark: { backgroundColor: colors.primary }
});
