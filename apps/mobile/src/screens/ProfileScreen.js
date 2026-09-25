import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BrandLogo from '../components/BrandLogo';
import { colors, spacing, radius } from '../theme';
import { useAuth } from '../context/AuthContext';

const RESIDENT_ROWS = [
  { key: 'Personal details', icon: 'person-outline', tint: '#EEF4EF', color: '#4A7C59', nav: 'PersonalDetails' },
  { key: 'Family members', icon: 'people-outline', tint: '#E8F0FA', color: '#3D6B8C', nav: 'FamilyMembers' },
  { key: 'My ads', icon: 'storefront-outline', tint: '#EEF4EF', color: '#4A7C59', nav: 'MyAds' },
  { key: 'Vehicles', icon: 'car-outline', tint: '#F3EDFA', color: '#6B5089', nav: 'Vehicles' },
  { key: 'Vendor services', icon: 'construct-outline', tint: '#FDF3E7', color: '#B87333', nav: 'VendorServices' },
  { key: 'Votes', icon: 'stats-chart-outline', tint: '#EEF4EF', color: '#4A7C59', nav: 'PastVotes' },
  { key: 'Support chat', icon: 'chatbubble-ellipses-outline', tint: '#E7EFE8', color: colors.accent, nav: 'SupportChat' },
  { key: 'Report a bug', icon: 'bug-outline', tint: '#FEE2E2', color: '#B4483A', nav: 'ReportBug' }
];

const GUARD_ROWS = [
  { key: 'Residents', icon: 'people-outline', tint: '#E8F0FA', color: '#3D6B8C', nav: 'GuardResidents' },
  { key: 'Support chat', icon: 'chatbubble-ellipses-outline', tint: '#E7EFE8', color: colors.accent, nav: 'SupportChat' },
  { key: 'Report a bug', icon: 'bug-outline', tint: '#FEE2E2', color: '#B4483A', nav: 'ReportBug' }
];

export default function ProfileScreen({ navigation }) {
  const {
    user,
    memberships,
    activeMembership,
    clearActiveMembership,
    logout
  } = useAuth();
  const isGuard = activeMembership?.role === 'guard';
  const rows = isGuard ? GUARD_ROWS : RESIDENT_ROWS;
  const initial = user?.name?.charAt(0)?.toUpperCase() || '?';
  const canSwitchSociety = !isGuard && (memberships || []).length > 1;

  const onRowPress = (item) => {
    if (item.nav) {
      const parent = navigation.getParent();
      if (parent) parent.navigate(item.nav);
      else navigation.navigate(item.nav);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, !isGuard && styles.headerCentered]}>
        {isGuard
          ? <Text style={styles.greeting}>Profile</Text>
          : <BrandLogo variant="wordmark-color" height={40} style={styles.brand} />}
        <View style={[styles.locationPill, !isGuard && styles.locationPillCentered]}>
          <Ionicons name={isGuard ? 'shield-outline' : 'business-outline'} size={13} color={colors.textMuted} />
          <Text style={styles.locationText}>
            {activeMembership?.buildingName}
            {isGuard ? ' · Gate' : activeMembership?.flat ? ` · ${activeMembership.flat}` : ''}
          </Text>
        </View>
      </View>

      <View style={styles.heroCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.heroBody}>
          <Text style={styles.name}>{user?.name}</Text>
          {user?.phone && <Text style={styles.phone}>{user.phone}</Text>}
          {isGuard ? (
            <View style={styles.flatBadge}>
              <Text style={styles.flatBadgeText}>Security guard</Text>
            </View>
          ) : activeMembership?.flat ? (
            <View style={styles.flatBadge}>
              <Text style={styles.flatBadgeText}>Flat {activeMembership.flat}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {canSwitchSociety && (
        <TouchableOpacity style={styles.switchSociety} onPress={clearActiveMembership} activeOpacity={0.88}>
          <View style={[styles.menuIcon, { backgroundColor: '#EEF4EF' }]}>
            <Ionicons name="swap-horizontal-outline" size={20} color="#4A7C59" />
          </View>
          <Text style={styles.menuLabel}>Switch flat</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}

      <Text style={styles.sectionLabel}>{isGuard ? 'Gate tools' : 'Account settings'}</Text>
      <View style={styles.menu}>
        {rows.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.menuItem}
            onPress={() => onRowPress(item)}
            activeOpacity={0.88}
          >
            <View style={[styles.menuIcon, { backgroundColor: item.tint }]}>
              <Ionicons name={item.icon} size={20} color={item.color} />
            </View>
            <Text style={styles.menuLabel}>{item.key}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={styles.logout} onPress={logout} activeOpacity={0.88}>
        <Ionicons name="log-out-outline" size={18} color={colors.error} />
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: spacing.lg, paddingBottom: 96 },
  header: { marginBottom: spacing.lg },
  headerCentered: { alignItems: 'center' },
  brand: { alignSelf: 'center', marginBottom: spacing.md },
  locationPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill,
    marginBottom: spacing.sm
  },
  locationPillCentered: { alignSelf: 'center', marginBottom: 0 },
  locationText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  greeting: { fontSize: 28, fontWeight: '700', color: colors.primary, letterSpacing: -0.5 },
  heroCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg,
    shadowColor: '#2B3A4A', shadowOpacity: 0.06, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 2, marginBottom: spacing.lg
  },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center'
  },
  avatarText: { fontSize: 26, fontWeight: '700', color: colors.accent },
  heroBody: { flex: 1 },
  name: { fontSize: 20, fontWeight: '700', color: colors.primary },
  phone: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  flatBadge: {
    alignSelf: 'flex-start', marginTop: 8, backgroundColor: colors.accentSoft,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill
  },
  flatBadgeText: { fontSize: 11, fontWeight: '600', color: colors.accent },
  sectionLabel: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm
  },
  switchSociety: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    shadowColor: '#2B3A4A', shadowOpacity: 0.05, shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 }, elevation: 2, marginBottom: spacing.lg
  },
  menu: { gap: spacing.sm },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    shadowColor: '#2B3A4A', shadowOpacity: 0.05, shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 }, elevation: 2
  },
  menuIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  logout: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: spacing.lg, padding: spacing.md, backgroundColor: colors.card,
    borderRadius: radius.md, borderWidth: 1, borderColor: '#F5D0CC',
    shadowColor: '#2B3A4A', shadowOpacity: 0.04, shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 }, elevation: 1
  },
  logoutText: { color: colors.error, fontWeight: '600', fontSize: 14 }
});
