import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, StatusBar } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import BrandLogo from '../components/BrandLogo';
import MarketplaceListingCard from '../components/MarketplaceListingCard';
import { DUMMY_MARKETPLACE_LISTINGS } from '../data/dummyMarketplace';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

/** Tokens from design-system.md (Emerald Fresh) */
const ds = {
  surface: '#ffffff',
  primary: '#059669',
  heading: '#06231a',
  secondary: '#2f5c4a',
  muted: '#7ba392',
  chevron: '#9dc4b3',
  onPrimary: '#ffffff'
};

const SHORTCUTS = [
  { target: 'Complaints', label: 'Complaints', icon: 'clipboard-outline', tint: '#d3f6e3', color: '#059669' },
  { target: 'FacilityBooking', label: 'Book facility', icon: 'calendar-outline', tint: '#e4ecf7', color: '#5b7fb0' },
  { target: 'Visitors', label: 'Visitors', icon: 'people-outline', tint: '#ebe4f7', color: '#7c5cbf' },
  { target: 'Announcements', label: 'Announcements', icon: 'megaphone-outline', tint: '#f7e9d8', color: '#c78a4a' }
];

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen({ navigation }) {
  const {
    user,
    memberships,
    activeMembership,
    activeBuildingId,
    clearActiveMembership
  } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [marketplace, setMarketplace] = useState(DUMMY_MARKETPLACE_LISTINGS);

  const load = useCallback(async () => {
    const [unread, listings] = await Promise.all([
      api.getUnreadNotificationCount(activeBuildingId).catch(() => ({ count: 0 })),
      api.getMarketplace(activeBuildingId).catch(() => [])
    ]);
    setUnreadCount(unread.count || 0);
    setMarketplace(
      listings.length > 0
        ? listings.slice(0, 4)
        : DUMMY_MARKETPLACE_LISTINGS
    );
  }, [activeBuildingId]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const id = 'home-hide-scrollbar';
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement('style');
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = '#home-scroll::-webkit-scrollbar,#home-scroll *::-webkit-scrollbar{display:none;width:0;height:0;}';
    return undefined;
  }, []);

  const firstName = user?.name?.split(' ')[0] || 'there';
  const locationLabel = [
    activeMembership?.buildingName,
    activeMembership?.flat
  ].filter(Boolean).join(' · ') || 'Your society';

  const canSwitchSociety = (memberships || []).length > 1;

  const topPad = Platform.OS === 'android'
    ? (StatusBar.currentHeight || 12)
    : Platform.OS === 'web'
      ? 16
      : 8;

  return (
    <ScrollView
      nativeID="home-scroll"
      style={[styles.scroll, Platform.OS === 'web' && styles.scrollWeb]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8 }]}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      <View style={styles.shell}>
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <BrandLogo variant="icon-color" height={28} />
            <TouchableOpacity
              style={styles.locationPill}
              onPress={() => canSwitchSociety && clearActiveMembership()}
              activeOpacity={canSwitchSociety ? 0.85 : 1}
              disabled={!canSwitchSociety}
            >
              <Ionicons name="business-outline" size={14} color={ds.primary} />
              <Text style={styles.locationText} numberOfLines={1}>{locationLabel}</Text>
              {canSwitchSociety && <Ionicons name="chevron-down" size={14} color={ds.primary} />}
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('Notifications')}
            style={styles.bellBtn}
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
        </View>

        <View style={styles.greetingRow}>
          <Ionicons name="leaf" size={22} color={ds.primary} style={styles.leafIcon} />
          <Text style={styles.greeting}>{getGreeting()}, {firstName}</Text>
        </View>

        <Text style={styles.sectionLabel}>Quick links</Text>
        <View style={styles.grid}>
          {SHORTCUTS.map((s) => (
            <TouchableOpacity
              key={s.target}
              style={styles.shortcut}
              onPress={() => navigation.navigate(s.target)}
              activeOpacity={0.88}
            >
              <View style={[styles.shortcutIcon, { backgroundColor: s.tint }]}>
                <Ionicons name={s.icon} size={16} color={s.color} />
              </View>
              <Text style={styles.shortcutLabel} numberOfLines={1} ellipsizeMode="tail">{s.label}</Text>
              <Ionicons name="chevron-forward" size={14} color={ds.chevron} style={{ flexShrink: 0 }} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.marketHeader}>
          <View style={styles.marketHeaderLeft}>
            <Text style={styles.marketTitle}>Marketplace</Text>
            <Text style={styles.marketSubtitle}>Buy, sell, and exchange within your society.</Text>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('Marketplace')}
            activeOpacity={0.88}
            style={styles.seeAllBtn}
          >
            <Text style={styles.seeAll}>See all</Text>
            <Ionicons name="chevron-forward" size={14} color={ds.primary} />
          </TouchableOpacity>
        </View>

        <View style={styles.marketGrid}>
          {marketplace.map((item) => (
            <MarketplaceListingCard
              key={item.id}
              item={item}
              onPress={() => navigation.navigate('Marketplace')}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: 'transparent' },
  scrollWeb: { scrollbarWidth: 'none', msOverflowStyle: 'none' },
  content: {
    flexGrow: 1,
    paddingBottom: 96
  },
  shell: {
    width: '100%',
    paddingHorizontal: 20
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18
  },
  topBarLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginRight: 12
  },
  locationPill: {
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
  locationText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    color: ds.secondary
  },
  bellBtn: {
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
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24
  },
  leafIcon: {
    marginRight: 8
  },
  greeting: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: ds.heading,
    letterSpacing: -0.5
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: ds.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 12
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12
  },
  shortcut: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: ds.surface,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 10,
    shadowColor: '#063c28',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2
  },
  shortcutIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  shortcutLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    fontWeight: '600',
    color: ds.secondary
  },
  marketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 28,
    marginBottom: 14
  },
  marketHeaderLeft: {
    flex: 1,
    paddingRight: 12
  },
  marketTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: ds.heading,
    letterSpacing: -0.3
  },
  marketSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: ds.muted,
    marginTop: 4,
    lineHeight: 17
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2
  },
  seeAll: {
    fontSize: 11,
    fontWeight: '600',
    color: ds.primary
  },
  marketGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14
  }
});
