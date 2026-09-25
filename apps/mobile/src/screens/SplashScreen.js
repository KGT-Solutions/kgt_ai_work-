import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import BrandLogo from '../components/BrandLogo';

export default function SplashScreen() {
  return (
    <View style={styles.container}>
      <BrandLogo variant="wordmark-color" height={48} style={styles.logo} />
      <Text style={styles.subtitle}>Your building, in one app.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg
  },
  logo: { marginBottom: spacing.md },
  subtitle: { marginTop: 4, fontSize: 16, color: colors.textMuted }
});
