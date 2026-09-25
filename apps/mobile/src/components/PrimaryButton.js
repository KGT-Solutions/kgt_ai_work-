import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, radius, spacing } from '../theme';

export default function PrimaryButton({ title, onPress, loading, disabled, variant = 'primary' }) {
  const bg = variant === 'accent' ? colors.accent : variant === 'danger' ? colors.error : colors.primary;
  return (
    <TouchableOpacity
      style={[styles.button, { backgroundColor: bg }, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.text}>{title}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  text: { color: '#fff', fontWeight: '600', fontSize: 16 }
});
