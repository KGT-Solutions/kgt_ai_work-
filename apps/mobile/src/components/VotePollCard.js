import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';

export default function VotePollCard({ vote, loading, onVote, resultsOnly = false }) {
  if (!vote) return null;

  const closed = !vote.isOpen;
  const winnerId = closed
    ? vote.options.reduce((best, o) => (!best || o.count > best.count ? o : best), null)?.id
    : null;

  return (
    <View style={styles.card}>
      {resultsOnly && (
        <View style={styles.closedBadge}>
          <Text style={styles.closedBadgeText}>Poll ended</Text>
        </View>
      )}

      <View style={styles.turnoutHeader}>
        <Text style={styles.turnoutLabel}>Overall turnout</Text>
        <Text style={styles.turnoutMeta}>{vote.totalVoted} / {vote.totalMembers} members</Text>
      </View>

      <View style={styles.turnoutBarTrack}>
        <View style={[styles.turnoutBarFill, { width: `${vote.turnoutPct}%` }]} />
      </View>

      <Text style={styles.turnoutPct}>{vote.turnoutPct}%</Text>

      <Text style={[styles.question, resultsOnly && styles.questionResults]}>{vote.question}</Text>

      <Text style={[styles.subMeta, resultsOnly && styles.subMetaResults]}>
        {closed
          ? `Ended ${new Date(vote.closesAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : `Voting closes in ${vote.daysLeft} day${vote.daysLeft === 1 ? '' : 's'}`}
        {' · '}{vote.totalVoted} of {vote.totalMembers} members voted
      </Text>

      <View style={[styles.optionRow, resultsOnly && styles.optionRowResults]}>
        {vote.options.map((option) => {
          const selected = vote.userOptionId === option.id;
          const isWinner = closed && option.id === winnerId;
          const disabled = closed || loading;
          return (
            <TouchableOpacity
              key={option.id}
              style={[
                styles.option,
                resultsOnly && styles.optionResults,
                closed && styles.optionClosed,
                selected && styles.optionSelected,
                isWinner && styles.optionWinner,
                disabled && !selected && !isWinner && styles.optionDisabled
              ]}
              onPress={() => onVote?.(vote.id, option.id)}
              disabled={disabled}
              activeOpacity={0.85}
            >
              <View style={styles.optionHeader}>
                {isWinner ? (
                  <View style={styles.winnerPill}>
                    <Text style={styles.winnerText}>Leading</Text>
                  </View>
                ) : (
                  <View style={styles.optionHeaderSpacer} />
                )}
                {selected && (
                  <Ionicons
                    name="checkmark-circle"
                    size={20}
                    color={isWinner || selected ? '#fff' : colors.accent}
                  />
                )}
              </View>

              <Text style={[styles.optionLabel, (selected || isWinner) && styles.optionLabelSelected]}>
                {option.label}
              </Text>
              <Text style={[styles.optionPct, (selected || isWinner) && styles.optionPctSelected]}>
                {option.pct}%
              </Text>
              {closed && (
                <Text style={[styles.optionCount, (selected || isWinner) && styles.optionCountSelected]}>
                  {option.count} vote{option.count !== 1 ? 's' : ''}
                </Text>
              )}
              <View style={[styles.optionBarTrack, (selected || isWinner) && styles.optionBarTrackSelected]}>
                <View style={[styles.optionBarFill, (selected || isWinner) && styles.optionBarFillSelected, { width: `${option.pct}%` }]} />
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.sm }} />}

      {!resultsOnly && (
        <View style={styles.secureRow}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.accent} />
          <Text style={styles.secureText}>Your vote is anonymous and secure</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.lg + 4,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.lg,
    shadowColor: '#2B3A4A',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  closedBadge: {
    alignSelf: 'flex-start', backgroundColor: '#F3F4F6', paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.pill, marginBottom: spacing.sm
  },
  closedBadgeText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  turnoutHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  turnoutLabel: { fontSize: 13, color: colors.textMuted },
  turnoutMeta: { fontSize: 13, color: colors.textMuted },
  turnoutBarTrack: {
    height: 8, backgroundColor: '#E8EDEA', borderRadius: 4, marginTop: spacing.sm, overflow: 'hidden'
  },
  turnoutBarFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 4 },
  turnoutPct: { fontSize: 13, fontWeight: '700', color: colors.accent, marginTop: 6, marginBottom: spacing.md },
  question: { fontSize: 22, fontWeight: '700', color: colors.primary, lineHeight: 30, marginBottom: spacing.sm },
  questionResults: { fontSize: 20, lineHeight: 28, marginBottom: spacing.md },
  subMeta: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
  subMetaResults: { marginBottom: spacing.lg },
  optionRow: { flexDirection: 'row', gap: spacing.sm },
  optionRowResults: { marginTop: spacing.xs },
  option: {
    flex: 1,
    minHeight: 150,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.lg,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: colors.card
  },
  optionResults: { minHeight: 188, paddingVertical: spacing.md + 2 },
  optionClosed: { minHeight: 188 },
  optionSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionWinner: { backgroundColor: '#2B5A3A', borderColor: '#2B5A3A' },
  optionDisabled: { opacity: 0.92 },
  optionHeader: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
    marginBottom: spacing.sm
  },
  optionHeaderSpacer: { width: 1 },
  winnerPill: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8
  },
  winnerText: { fontSize: 10, fontWeight: '700', color: '#fff' },
  optionLabel: { fontSize: 20, fontWeight: '700', color: colors.primary, marginTop: 2 },
  optionLabelSelected: { color: '#fff' },
  optionPct: { fontSize: 26, fontWeight: '700', color: colors.accent, marginTop: spacing.sm },
  optionPctSelected: { color: '#fff' },
  optionCount: { fontSize: 12, color: colors.textMuted, marginTop: 6, marginBottom: 4 },
  optionCountSelected: { color: 'rgba(255,255,255,0.85)' },
  optionBarTrack: {
    width: '100%', height: 5, backgroundColor: '#E8EDEA', borderRadius: 3, marginTop: spacing.sm, overflow: 'hidden'
  },
  optionBarTrackSelected: { backgroundColor: 'rgba(255,255,255,0.35)' },
  optionBarFill: { height: '100%', backgroundColor: colors.accent },
  optionBarFillSelected: { backgroundColor: '#fff' },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.lg, justifyContent: 'center' },
  secureText: { fontSize: 12, color: colors.textMuted }
});
