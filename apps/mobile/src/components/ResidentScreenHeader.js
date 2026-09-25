import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, StatusBar } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import BrandLogo from './BrandLogo';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

/** Tokens from design-system.md (Emerald Fresh) — matches ComplaintsScreen */
const ds = {
  surface: '#ffffff',
  primary: '#059669',
  heading: '#06231a',
  secondary: '#2f5c4a',
  onPrimary: '#ffffff'
};

export default function ResidentScreenHeader({
  navigation,
  title,
  locationLabel,
  locationIcon = 'business-outline',
  showBack = false,
  showBell = true,
  onBack
}) {
  const { activeBuildingId, activeMembershipId } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!showBell || !activeBuildingId) return undefined;
    api.getUnreadNotificationCount(activeBuildingId)
      .then((unread) => setUnreadCount(unread.count || 0))
      .catch(() => {});
    return undefined;
  }, [showBell, activeBuildingId, activeMembershipId]));

  const topPad = Platform.OS === 'android'
    ? (StatusBar.currentHeight || 12)
    : Platform.OS === 'web'
      ? 16
      : 8;

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (navigation?.canGoBack()) navigation.goBack();
    else navigation?.navigate('Home');
  };

  return (
    <View style={[styles.header, { paddingTop: topPad + 8 }]}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <BrandLogo variant="icon-color" height={28} />
          {locationLabel ? (
            <View style={styles.chip}>
              <Ionicons name={locationIcon} size={14} color={ds.primary} />
              <Text style={styles.chipText} numberOfLines={1}>{locationLabel}</Text>
            </View>
          ) : null}
        </View>
        {showBell && navigation ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('Notifications')}
            style={styles.iconBtn}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={20} color={ds.heading} />
            {unreadCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.titleRow}>
        {showBack ? (
          <TouchableOpacity
            onPress={handleBack}
            style={styles.backBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={16} color={ds.heading} />
          </TouchableOpacity>
        ) : null}
        <Text style={styles.title}>{title}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    marginBottom: 16
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20
  },
  topBarLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginRight: 12
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    backgroundColor: ds.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    shadowColor: '#063c28',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    color: ds.secondary
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: ds.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#063c28',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: ds.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3
  },
  bellBadgeText: {
    color: ds.onPrimary,
    fontSize: 9,
    fontWeight: '700'
  },
  backBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ds.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#063c28',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  title: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: ds.heading,
    letterSpacing: -0.5
  }
});
