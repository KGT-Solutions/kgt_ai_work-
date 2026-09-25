import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, radius } from '../theme';
import HorizontalScrollRow from './HorizontalScrollRow';

function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function DateScrollRow({
  dates,
  selectedKey,
  onSelectDate,
  formatLabel,
  scrollNativeId,
  label = 'Select date',
  labelStyle
}) {
  return (
    <HorizontalScrollRow
      label={label}
      labelStyle={labelStyle}
      scrollNativeId={scrollNativeId}
      contentContainerStyle={styles.dateRowContent}
    >
      {dates.map((d) => {
        const key = toDateKey(d);
        const active = key === selectedKey;
        return (
          <TouchableOpacity key={key} onPress={() => onSelectDate(d)}>
            <View style={[styles.dateChip, active && styles.dateChipActive]}>
              <Text style={[styles.dateText, active && styles.dateTextActive]}>
                {formatLabel(d)}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </HorizontalScrollRow>
  );
}

const styles = StyleSheet.create({
  dateRowContent: { gap: spacing.sm },
  dateChip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border
  },
  dateChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  dateText: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  dateTextActive: { color: '#fff', fontWeight: '600' }
});
