import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import ScreenShell from '../components/ScreenShell';
import { useAuth } from '../context/AuthContext';

const ITEMS = [
  { key: 'Announcements', label: 'Announcements', icon: 'megaphone-outline', tint: '#FDF3E7', color: '#B87333' },
  { key: 'Voting', label: 'Society votes', icon: 'stats-chart-outline', tint: '#EEF4EF', color: '#4A7C59' },
  { key: 'FacilityBooking', label: 'Book a facility', icon: 'calendar-outline', tint: '#E8F0FA', color: '#3D6B8C' },
  { key: 'Marketplace', label: 'Marketplace', icon: 'storefront-outline', tint: '#F3EDFA', color: '#6B5089' },
  { key: 'Visitors', label: 'Visitors', icon: 'people-outline', tint: '#E8F0FA', color: '#3D6B8C' },
  { key: 'Emergency', label: 'Emergency directory', icon: 'call-outline', tint: '#FEE2E2', color: '#B4483A' }
];

export default function CommunityScreen({ navigation }) {
  const { activeMembership } = useAuth();

  return (
    <ScreenShell
      title="Community"
      locationLabel={`${activeMembership?.buildingName} · ${activeMembership?.flat}`}
    >
      <View style={styles.grid}>
        {ITEMS.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.item}
            onPress={() => navigation.navigate(item.key)}
            activeOpacity={0.88}
          >
            <View style={[styles.icon, { backgroundColor: item.tint }]}>
              <Ionicons name={item.icon} size={20} color={item.color} />
            </View>
            <Text style={styles.label}>{item.label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={styles.chevron} />
          </TouchableOpacity>
        ))}
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  grid: { gap: spacing.sm },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    shadowColor: '#2B3A4A', shadowOpacity: 0.05, shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 }, elevation: 2
  },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  chevron: { marginLeft: 'auto' }
});
