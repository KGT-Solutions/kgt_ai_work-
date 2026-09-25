import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import VotePollCard from '../components/VotePollCard';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function PastVotesScreen() {
  const { activeBuildingId } = useAuth();
  const [closedVotes, setClosedVotes] = useState([]);

  const load = useCallback(async () => {
    const votes = await api.getVotes(activeBuildingId);
    setClosedVotes(votes.filter((v) => !v.isOpen));
  }, [activeBuildingId]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>View results from polls that have ended in your society.</Text>

      {closedVotes.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bar-chart-outline" size={40} color={colors.border} />
          <Text style={styles.emptyTitle}>No past polls yet</Text>
          <Text style={styles.emptyText}>
            When a society vote closes, the full results will appear here for your reference.
          </Text>
        </View>
      ) : (
        closedVotes.map((vote) => (
          <VotePollCard key={vote.id} vote={vote} resultsOnly />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 20 },
  empty: {
    alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, marginTop: spacing.md },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 20 }
});
