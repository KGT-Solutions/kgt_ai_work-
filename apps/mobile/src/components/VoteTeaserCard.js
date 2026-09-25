import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';

export default function VoteTeaserCard({ vote, onPress }) {
  if (!vote?.isOpen) return null;

  const voted = !!vote.userOptionId;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.92}>
      <View style={styles.iconWrap}>
        <Ionicons name="stats-chart" size={20} color={colors.accent} />
      </View>
      <View style={styles.body}>
        <View style={styles.row}>
          <Text style={styles.eyebrow}>Society poll</Text>
          {voted && (
            <View style={styles.votedPill}>
              <Text style={styles.votedText}>Voted</Text>
            </View>
          )}
        </View>
        <Text style={styles.question} numberOfLines={2}>{vote.question}</Text>
        <Text style={styles.meta}>
          {vote.daysLeft}d left · {vote.totalVoted}/{vote.totalMembers} residents
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: '#2B3A4A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#EEF4EF',
    alignItems: 'center',
    justifyContent: 'center'
  },
  body: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { fontSize: 11, fontWeight: '600', color: colors.accent, textTransform: 'uppercase', letterSpacing: 0.6 },
  votedPill: { backgroundColor: '#EEF4EF', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  votedText: { fontSize: 10, fontWeight: '600', color: colors.accent },
  question: { fontSize: 15, fontWeight: '600', color: colors.primary, marginTop: 4, lineHeight: 21 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 4 }
});
