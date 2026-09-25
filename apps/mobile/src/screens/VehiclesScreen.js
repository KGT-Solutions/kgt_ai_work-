import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { showAlert } from '../utils/alert';
import PrimaryButton from '../components/PrimaryButton';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = [
  { key: 'car', label: 'Car', icon: 'car-outline' },
  { key: 'bike', label: 'Bike', icon: 'bicycle-outline' },
  { key: 'scooter', label: 'Scooter', icon: 'speedometer-outline' },
  { key: 'ev', label: 'Electric', icon: 'flash-outline' },
  { key: 'commercial', label: 'Commercial', icon: 'bus-outline' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' }
];

const STATUS_STYLE = {
  submitted: { bg: '#FEF3F2', color: '#B4483A' },
  in_progress: { bg: '#FFFBF5', color: '#D98E3B' },
  done: { bg: '#E8F0E9', color: '#4A7C59' }
};

function StatusBadge({ status, label }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.submitted;
  return (
    <View style={[styles.badge, { backgroundColor: style.bg }]}>
      <Text style={[styles.badgeText, { color: style.color }]}>{label}</Text>
    </View>
  );
}

export default function VehiclesScreen() {
  const { activeBuildingId, activeMembership, activeMembershipId } = useAuth();
  const buildingId = activeBuildingId || activeMembership?.buildingId;

  const [vehicles, setVehicles] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState('car');
  const [makeModel, setMakeModel] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [color, setColor] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!buildingId) return;
    setVehicles(await api.getVehicles(buildingId));
  }, [buildingId, activeMembershipId]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const submit = async () => {
    if (!makeModel.trim() || !registrationNumber.trim()) {
      showAlert('Missing details', 'Please enter vehicle name and registration number.');
      return;
    }
    if (!buildingId) {
      showAlert('Session error', 'Building not found. Please log out and sign in again.');
      return;
    }

    setLoading(true);
    try {
      await api.addVehicle({
        category,
        makeModel: makeModel.trim(),
        registrationNumber: registrationNumber.trim(),
        color: color.trim() || undefined
      }, buildingId);
      setMakeModel('');
      setRegistrationNumber('');
      setColor('');
      setCategory('car');
      setShowForm(false);
      await load();
      showAlert(
        'Request submitted',
        'Your gate pass request has been sent to the building admin.'
      );
    } catch (e) {
      showAlert('Could not register', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.hint}>
        Register vehicles linked to flat {activeMembership?.flat || '—'}. Each new vehicle raises a gate pass request for admin approval.
      </Text>

      {!showForm ? (
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowForm(true)} activeOpacity={0.88}>
          <View style={styles.addIcon}>
            <Ionicons name="add" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.addTitle}>Add vehicle</Text>
            <Text style={styles.addMeta}>Submit a gate pass request</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      ) : (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Register vehicle</Text>
          <Text style={styles.label}>Category</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c.key}
                style={[styles.chip, category === c.key && styles.chipActive]}
                onPress={() => setCategory(c.key)}
              >
                <Ionicons name={c.icon} size={14} color={category === c.key ? '#fff' : colors.textMuted} />
                <Text style={[styles.chipText, category === c.key && styles.chipTextActive]}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            placeholder="Make & model (e.g. Honda City)"
            value={makeModel}
            onChangeText={setMakeModel}
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            style={styles.input}
            placeholder="Registration number (e.g. DL01AB1234)"
            value={registrationNumber}
            onChangeText={setRegistrationNumber}
            autoCapitalize="characters"
            placeholderTextColor={colors.textMuted}
          />
          <TextInput
            style={styles.input}
            placeholder="Color (optional)"
            value={color}
            onChangeText={setColor}
            placeholderTextColor={colors.textMuted}
          />
          <PrimaryButton title="Submit gate pass request" onPress={submit} loading={loading} />
          <TouchableOpacity onPress={() => setShowForm(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.sectionLabel}>Your vehicles ({vehicles.length})</Text>

      {vehicles.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="car-outline" size={40} color={colors.border} />
          <Text style={styles.empty}>No vehicles registered yet.</Text>
        </View>
      ) : (
        vehicles.map((item) => {
          const cat = CATEGORIES.find((c) => c.key === item.category) || CATEGORIES[0];
          return (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardIcon}>
                <Ionicons name={cat.icon} size={22} color="#6B5089" />
              </View>
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle}>{item.makeModel}</Text>
                  <StatusBadge status={item.gatePassStatus} label={item.gatePassStatusLabel} />
                </View>
                <Text style={styles.cardPlate}>{item.registrationNumber}</Text>
                <Text style={styles.cardMeta}>
                  {item.categoryLabel}{item.color ? ` · ${item.color}` : ''}
                  {item.flatNumber ? ` · Flat ${item.flatNumber}` : ''}
                </Text>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  hint: { fontSize: 13, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.lg },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.lg, shadowColor: '#2B3A4A', shadowOpacity: 0.05,
    shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2
  },
  addIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center'
  },
  addTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  addMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  formCard: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.lg,
    marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border
  },
  formTitle: { fontSize: 18, fontWeight: '700', color: colors.primary, marginBottom: spacing.md },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  chipTextActive: { color: '#fff' },
  input: {
    backgroundColor: colors.background, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: 12,
    fontSize: 15, color: colors.text, marginBottom: spacing.sm
  },
  cancelBtn: { alignItems: 'center', marginTop: spacing.md },
  cancelText: { color: colors.textMuted, fontWeight: '600' },
  sectionLabel: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm
  },
  emptyWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  empty: { marginTop: spacing.md, color: colors.textMuted, fontWeight: '600' },
  card: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: colors.card,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border
  },
  cardIcon: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: '#F3EDFA',
    alignItems: 'center', justifyContent: 'center'
  },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  cardPlate: { fontSize: 14, fontWeight: '700', color: colors.primary, marginTop: 4, letterSpacing: 0.5 },
  cardMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '700' }
});
