import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '../theme';
import VotePollCard from '../components/VotePollCard';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function VotingScreen({ route, navigation }) {
  const { activeBuildingId } = useAuth();
  const [votes, setVotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const focusVoteId = route.params?.voteId;

  const load = useCallback(async () => {
    setVotes(await api.getVotes(activeBuildingId));
  }, [activeBuildingId]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const respond = async (voteId, optionId) => {
    setLoading(true);
    try {
      const updated = await api.respondToVote(voteId, optionId, activeBuildingId);
      setVotes((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    } finally {
      setLoading(false);
    }
  };

  const openVotes = votes.filter((v) => v.isOpen);
  const closedVotes = votes.filter((v) => !v.isOpen);
  const ordered = focusVoteId
    ? [...openVotes.sort((a, b) => (a.id === focusVoteId ? -1 : b.id === focusVoteId ? 1 : 0))]
    : openVotes;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Society Vote</Text>
        <View style={{ width: 32 }} />
      </View>

      {ordered.length === 0 && closedVotes.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bar-chart-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No polls right now</Text>
          <Text style={styles.emptyText}>When your building admin creates a poll, it will appear here.</Text>
        </View>
      ) : (
        <>
          {ordered.map((vote) => (
            <VotePollCard key={vote.id} vote={vote} loading={loading} onVote={respond} />
          ))}

          {closedVotes.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Past polls</Text>
              {closedVotes.map((vote) => (
                <VotePollCard key={vote.id} vote={vote} loading={false} />
              ))}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.primary },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, marginTop: spacing.md },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm, maxWidth: 280, lineHeight: 20 }
});
