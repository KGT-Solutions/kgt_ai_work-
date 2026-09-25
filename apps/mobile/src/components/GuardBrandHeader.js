import React from 'react';
import { View, Text, StyleSheet, Platform, StatusBar } from 'react-native';
import BrandLogo from './BrandLogo';
import { colors } from '../theme';

/**
 * Guard shell header — Emerald Fresh white surface + soft shadow.
 * Simple rectangular bar (not rounded like the floating footer).
 */
export default function GuardBrandHeader() {
  const topPad = Platform.OS === 'android'
    ? (StatusBar.currentHeight || 0)
    : Platform.OS === 'web'
      ? 12
      : 8;

  return (
    <View style={[styles.bar, { paddingTop: topPad + 8 }]}>
      <BrandLogo
        variant="wordmark-color"
        height={36}
        fallbackColor={colors.primaryInk}
        style={styles.logo}
      />
      <Text style={styles.role}>Guard</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#ffffff',
    paddingLeft: 14,
    paddingRight: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2f2ea',
    shadowColor: '#063c28',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3
  },
  logo: {
    marginLeft: 0
  },
  role: {
    fontSize: 11,
    fontWeight: '600',
    color: '#7ba392',
    letterSpacing: 0.2
  }
});
