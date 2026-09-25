import React, { useMemo, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';

function matchesQuery(building, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    building.name?.toLowerCase().includes(q)
    || building.buildingCode?.toLowerCase().includes(q)
    || building.city?.toLowerCase().includes(q)
  );
}

export default function BuildingSearchSelect({
  buildings = [],
  selected,
  onSelect,
  loading = false,
  label = 'Building',
  placeholder = 'Search by building name or code…',
  disabled = false,
  error = null
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () => buildings.filter((b) => matchesQuery(b, query)),
    [buildings, query]
  );

  const choose = (building) => {
    onSelect(building);
    setQuery('');
    setOpen(false);
  };

  const displayValue = open
    ? query
    : selected
      ? selected.name
      : '';

  return (
    <View style={styles.wrap}>
      {!!label && <Text style={[styles.label, error && styles.labelError]}>{label}</Text>}
      <View style={[styles.searchRow, disabled && styles.disabled, error && styles.searchRowError]}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          style={styles.input}
          placeholder={loading ? 'Loading buildings…' : placeholder}
          placeholderTextColor={colors.textMuted}
          value={displayValue}
          editable={!disabled && !loading}
          onChangeText={(text) => {
            setQuery(text);
            setOpen(true);
            if (selected && text !== selected.name) {
              onSelect(null);
            }
          }}
          onFocus={() => setOpen(true)}
        />
        {loading ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : selected && !open ? (
          <TouchableOpacity onPress={() => { setOpen(true); setQuery(''); }} hitSlop={8}>
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {selected && !open && (
        <Text style={styles.meta}>
          {selected.buildingCode}{selected.city ? ` · ${selected.city}` : ''}
        </Text>
      )}

      {!!error && <Text style={styles.fieldError}>{error}</Text>}

      {open && !loading && (
        <View style={styles.dropdown}>
          <ScrollView
            style={[styles.list, Platform.OS === 'web' && styles.listWeb]}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
          >
            {filtered.length === 0 ? (
              <Text style={styles.empty}>No buildings match your search</Text>
            ) : (
              filtered.map((building) => {
                const active = selected?.id === building.id;
                return (
                  <TouchableOpacity
                    key={building.id}
                    style={[styles.option, active && styles.optionActive]}
                    onPress={() => choose(building)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.optionName}>{building.name}</Text>
                      <Text style={styles.optionMeta}>
                        {building.buildingCode}{building.city ? ` · ${building.city}` : ''}
                      </Text>
                    </View>
                    {active && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md, zIndex: 10 },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: '600' },
  labelError: { color: colors.error },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.card
  },
  searchRowError: { borderColor: colors.error },
  fieldError: { color: colors.error, fontSize: 12, marginTop: 6, lineHeight: 16 },
  disabled: { opacity: 0.6 },
  input: { flex: 1, fontSize: 16, color: colors.text, paddingVertical: spacing.sm },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 6, marginLeft: 4 },
  dropdown: {
    marginTop: 6, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    backgroundColor: colors.card, maxHeight: 220, overflow: 'hidden'
  },
  list: { maxHeight: 220 },
  listWeb: { scrollbarWidth: 'none', msOverflowStyle: 'none' },
  option: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border
  },
  optionActive: { backgroundColor: '#F3F7F4' },
  optionName: { fontSize: 15, fontWeight: '600', color: colors.primary },
  optionMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  empty: { padding: spacing.md, color: colors.textMuted, textAlign: 'center', fontSize: 13 }
});
