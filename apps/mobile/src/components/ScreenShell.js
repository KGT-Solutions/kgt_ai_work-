import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, layout } from '../theme';

export function ScreenHeader({
  title,
  subtitle,
  locationLabel,
  locationIcon = 'business-outline',
  headerRight,
  onBackPress
}) {
  const topPad = onBackPress && Platform.OS === 'web'
    ? spacing.md
    : onBackPress && Platform.OS === 'android'
      ? (StatusBar.currentHeight || spacing.sm)
      : 0;

  return (
    <View style={[styles.headerBlock, topPad ? { paddingTop: topPad } : null]}>
      {onBackPress && (
        <TouchableOpacity
          onPress={onBackPress}
          style={styles.backBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </TouchableOpacity>
      )}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {locationLabel && (
            <View style={layout.locationPill}>
              <Ionicons name={locationIcon} size={13} color={colors.textMuted} />
              <Text style={layout.locationText}>{locationLabel}</Text>
            </View>
          )}
          {title && <Text style={typography.title}>{title}</Text>}
          {subtitle && <Text style={typography.subtitle}>{subtitle}</Text>}
        </View>
        {headerRight}
      </View>
    </View>
  );
}

export default function ScreenShell({
  title,
  subtitle,
  locationLabel,
  locationIcon = 'business-outline',
  children,
  scroll = false,
  flex = false,
  headerRight,
  onBackPress,
  contentStyle
}) {
  const header = (
    <ScreenHeader
      title={title}
      subtitle={subtitle}
      locationLabel={locationLabel}
      locationIcon={locationIcon}
      headerRight={headerRight}
      onBackPress={onBackPress}
    />
  );

  if (scroll) {
    return (
      <ScrollView style={layout.screen} contentContainerStyle={[layout.screenPad, contentStyle]} showsVerticalScrollIndicator={false}>
        {header}
        {children}
      </ScrollView>
    );
  }

  return (
    <View style={[layout.screen, flex && styles.flex, layout.screenPad, contentStyle]}>
      {header}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  headerBlock: { marginBottom: spacing.lg },
  backBtn: { alignSelf: 'flex-start', padding: 4, marginBottom: spacing.sm, marginLeft: -4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flex: 1, paddingRight: spacing.md },
  flex: { flex: 1 }
});
