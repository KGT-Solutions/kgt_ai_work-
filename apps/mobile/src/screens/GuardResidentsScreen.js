import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, SectionList, TextInput, TouchableOpacity, Linking
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { SkeletonList } from '../components/Skeleton';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { showError } from '../utils/alert';

export default function GuardResidentsScreen() {
  const { activeBuildingId, activeMembership } = useAuth();
  const [flats, setFlats] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeBuildingId) return;
    setLoading(true);
    try {
      setFlats(await api.getBuildingFlats(activeBuildingId));
    } catch (e) {
      setFlats([]);
      showError(e.message || 'Could not load residents');
    } finally {
      setLoading(false);
    }
  }, [activeBuildingId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = flats.filter((f) => {
      if (!q) return true;
      const residentHit = f.residents?.some((r) =>
        r.name?.toLowerCase().includes(q) || r.phone?.includes(q)
      );
      return f.number.toLowerCase().includes(q) || f.wing?.toLowerCase().includes(q) || residentHit;
    });

    return filtered.map((flat) => ({
      title: flat.number,
      wing: flat.wing,
      hasVehicle: flat.hasVehicle,
      vehicles: flat.vehicles || [],
      data: flat.residents?.length
        ? flat.residents
        : [{ membershipId: `empty-${flat.id}`, empty: true }]
    }));
  }, [flats, query]);

  const call = (phone) => {
    if (phone) Linking.openURL(`tel:${phone}`);
  };

  if (loading) {
    return (
      <View style={[styles.container, { padding: spacing.lg }]}>
        <SkeletonList count={6} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.subtitle}>{activeMembership?.buildingName || 'Building'} · all flats</Text>
        <TextInput
          style={styles.search}
          placeholder="Search flat, name or phone"
          value={query}
          onChangeText={setQuery}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
        />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.membershipId}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <Text style={styles.empty}>No residents found.</Text>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.flatNumber}>Flat {section.title}</Text>
              <Text style={styles.wing}>Wing {section.wing}</Text>
            </View>
            <View style={[styles.vehicleBadge, section.hasVehicle ? styles.vehicleYes : styles.vehicleNo]}>
              <Ionicons
                name={section.hasVehicle ? 'car-outline' : 'car-outline'}
                size={14}
                color={section.hasVehicle ? '#2E7D32' : colors.textMuted}
              />
              <Text style={[styles.vehicleText, section.hasVehicle && styles.vehicleTextYes]}>
                {section.hasVehicle
                  ? `${section.vehicles.length} vehicle${section.vehicles.length === 1 ? '' : 's'}`
                  : 'No vehicle'}
              </Text>
            </View>
          </View>
        )}
        renderItem={({ item, section }) => {
          if (item.empty) {
            return <Text style={styles.vacant}>No approved residents</Text>;
          }
          return (
            <View style={styles.residentCard}>
              <View style={styles.residentBody}>
                <Text style={styles.residentName}>{item.name}</Text>
                <Text style={styles.residentPhone}>{item.phone || 'No phone'}</Text>
                {section.hasVehicle && section.vehicles[0] && (
                  <Text style={styles.vehicleRegs}>
                    {section.vehicles.map((v) => v.registrationNumber).join(' · ')}
                  </Text>
                )}
              </View>
              {!!item.phone && (
                <TouchableOpacity style={styles.callBtn} onPress={() => call(item.phone)}>
                  <Ionicons name="call-outline" size={18} color={colors.accent} />
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  subtitle: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm },
  search: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md,
    fontSize: 15, backgroundColor: colors.card
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: spacing.lg, marginBottom: spacing.sm
  },
  flatNumber: { fontSize: 16, fontWeight: '700', color: colors.primary },
  wing: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  vehicleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill
  },
  vehicleYes: { backgroundColor: '#E8F5E9' },
  vehicleNo: { backgroundColor: '#F5F5F5' },
  vehicleText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  vehicleTextYes: { color: '#2E7D32' },
  residentCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border
  },
  residentBody: { flex: 1 },
  residentName: { fontSize: 15, fontWeight: '600', color: colors.text },
  residentPhone: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  vehicleRegs: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  callBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft || '#EEF4EF',
    alignItems: 'center', justifyContent: 'center'
  },
  vacant: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic', marginBottom: spacing.sm },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl }
});
