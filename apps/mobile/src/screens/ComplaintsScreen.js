import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import ResidentScreenHeader from '../components/ResidentScreenHeader';
import { api, mediaUrl } from '../api/client';
import { useAuth } from '../context/AuthContext';

/** Tokens from design-system.md (Emerald Fresh) — use MD greens, not light Figma greens */
const ds = {
  surface: '#ffffff',
  primary: '#059669',
  primaryLight: '#34d39a',
  heading: '#06231a',
  secondary: '#2f5c4a',
  muted: '#7ba392',
  chevron: '#9dc4b3',
  track: '#e2f2ea',
  onPrimary: '#ffffff',
  tileBg: '#d3f6e3',
  paidFg: '#0a7a55',
  paidBg: '#cdf3e2',
  dueFg: '#8a6a2f',
  dueBg: '#f4ead1',
  neutralFg: '#4f7a67',
  neutralBg: '#dbeee5'
};

function statusMeta(status) {
  if (status === 'resolved') return { bg: ds.paidBg, fg: ds.paidFg, label: 'Resolved' };
  if (status === 'in_progress') return { bg: ds.dueBg, fg: ds.dueFg, label: 'In progress' };
  return { bg: ds.neutralBg, fg: ds.neutralFg, label: 'Submitted' };
}

function ComplaintCard({ item }) {
  const st = statusMeta(item.status);

  return (
    <View style={styles.card}>
      <View style={styles.cardIconWrap}>
        <View style={styles.cardIcon}>
          <Ionicons name="clipboard-outline" size={18} color={ds.primary} />
        </View>
        <View style={styles.cardDivider} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
        {item.imageUrl ? (
          <Image source={{ uri: mediaUrl(item.imageUrl) }} style={styles.thumb} />
        ) : null}
        <View style={[styles.badge, { backgroundColor: st.bg }]}>
          <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={ds.chevron} style={styles.cardChevron} />
    </View>
  );
}

export default function ComplaintsScreen({ navigation }) {
  const { activeBuildingId, activeMembership, activeMembershipId } = useAuth();
  const [complaints, setComplaints] = useState([]);
  const [tab, setTab] = useState('active');

  const load = useCallback(async () => {
    if (!activeBuildingId) return;
    setComplaints(await api.getComplaints(activeBuildingId));
  }, [activeBuildingId, activeMembershipId]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const filtered = complaints.filter((c) =>
    (tab === 'active' ? c.status !== 'resolved' : c.status === 'resolved')
  );

  const locationLabel = [
    activeMembership?.buildingName,
    activeMembership?.flat
  ].filter(Boolean).join(' · ') || 'Your society';

  return (
    <View style={styles.root}>
      <ResidentScreenHeader
        navigation={navigation}
        title="Complaints"
        locationLabel={locationLabel}
        showBack
        onBack={() => navigation.navigate('Home')}
      />

      <View style={styles.body}>
        <View style={styles.segment}>
          {['active', 'resolved'].map((key) => {
            const active = tab === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.segButton, active && styles.segActive]}
                onPress={() => setTab(key)}
                activeOpacity={0.88}
              >
                {active ? (
                  <LinearGradient
                    colors={[ds.primaryLight, ds.primary]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={styles.segGradient}
                  >
                    <Text style={styles.segTextActive}>
                      {key === 'active' ? 'Active' : 'Resolved'}
                    </Text>
                  </LinearGradient>
                ) : (
                  <Text style={styles.segText}>
                    {key === 'active' ? 'Active' : 'Resolved'}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(c) => c.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubble-ellipses-outline" size={44} color={ds.chevron} />
              <Text style={styles.emptyTitle}>All quiet on your floor</Text>
              <Text style={styles.emptyHint}>Active and resolved complaints will show here.</Text>
            </View>
          }
          renderItem={({ item }) => <ComplaintCard item={item} />}
        />
      </View>

      <TouchableOpacity
        style={styles.fab}
        onPress={() => navigation.navigate('RaiseComplaint')}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel="Raise a complaint"
      >
        <LinearGradient
          colors={[ds.primaryLight, ds.primary]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.fabInner}
        >
          <Ionicons name="add" size={28} color={ds.onPrimary} />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  body: {
    flex: 1
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: ds.track,
    borderRadius: 14,
    padding: 4,
    marginBottom: 16,
    marginHorizontal: 20
  },
  segButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40
  },
  segActive: {},
  segGradient: {
    width: '100%',
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 12
  },
  segText: {
    color: ds.muted,
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: 10
  },
  segTextActive: {
    color: ds.onPrimary,
    fontWeight: '700',
    fontSize: 13
  },
  list: { flex: 1 },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 120
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ds.surface,
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(203, 232, 219, 0.9)',
    shadowColor: '#063c28',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1
  },
  cardIconWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: ds.tileBg,
    alignItems: 'center',
    justifyContent: 'center'
  },
  cardDivider: {
    width: 2,
    height: 36,
    backgroundColor: ds.primaryLight,
    marginLeft: 10,
    borderRadius: 2,
    opacity: 0.7
  },
  cardBody: {
    flex: 1,
    paddingRight: 8
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: ds.heading,
    marginBottom: 4
  },
  cardDesc: {
    fontSize: 12,
    fontWeight: '500',
    color: ds.muted,
    lineHeight: 17,
    marginBottom: 8
  },
  thumb: {
    width: '100%',
    height: 120,
    borderRadius: 14,
    marginBottom: 8,
    backgroundColor: ds.track
  },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700'
  },
  cardChevron: {
    marginLeft: 4
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 8
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: ds.heading
  },
  emptyHint: {
    fontSize: 12,
    color: ds.muted,
    textAlign: 'center'
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 96,
    width: 56,
    height: 56,
    borderRadius: 28,
    shadowColor: '#059669',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4
  },
  fabInner: {
    flex: 1,
    borderRadius: 28,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center'
  }
});
