import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { showAlert } from '../utils/alert';
import PrimaryButton from '../components/PrimaryButton';
import DateScrollRow from '../components/DateScrollRow';
import { useAuth } from '../context/AuthContext';

const SERVICES = [
  { id: 'ac', name: 'AC repair', icon: 'snow-outline', tint: '#E8F4FC', color: '#3D6B8C', desc: 'Servicing, gas refill, installation' },
  { id: 'electronics', name: 'Electronics', icon: 'tv-outline', tint: '#F3EDFA', color: '#6B5089', desc: 'TV, laptop, inverter repair' },
  { id: 'plumbing', name: 'Plumbing', icon: 'water-outline', tint: '#E8F0FA', color: '#3D6B8C', desc: 'Leaks, taps, pipes, drainage' },
  { id: 'electrical', name: 'Electrical', icon: 'flash-outline', tint: '#FEF3C7', color: '#B87333', desc: 'Wiring, switches, MCB, fans' },
  { id: 'carpentry', name: 'Carpentry', icon: 'hammer-outline', tint: '#FDF3E7', color: '#B87333', desc: 'Doors, furniture, fittings' },
  { id: 'pest', name: 'Pest control', icon: 'bug-outline', tint: '#FEE2E2', color: '#B4483A', desc: 'Cockroaches, termites, rodents' },
  { id: 'cleaning', name: 'Deep cleaning', icon: 'sparkles-outline', tint: '#EEF4EF', color: '#4A7C59', desc: 'Home, kitchen, bathroom cleaning' },
  { id: 'painting', name: 'Painting', icon: 'color-palette-outline', tint: '#FDF3E7', color: '#B87333', desc: 'Interior, exterior touch-ups' },
  { id: 'appliance', name: 'Appliances', icon: 'cafe-outline', tint: '#EEF4EF', color: '#4A7C59', desc: 'Fridge, washing machine, microwave' },
  { id: 'locksmith', name: 'Locksmith', icon: 'key-outline', tint: '#F5F5F5', color: '#616161', desc: 'Lock change, key duplication' },
  { id: 'purifier', name: 'Water purifier', icon: 'filter-outline', tint: '#E8F4FC', color: '#3D6B8C', desc: 'RO service, filter replacement' },
  { id: 'cctv', name: 'CCTV / security', icon: 'videocam-outline', tint: '#F3EDFA', color: '#6B5089', desc: 'Camera install & troubleshooting' }
];

const SLOT_HOURS = [9, 10, 11, 12, 14, 15, 16, 17, 18];

function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayLabel(d) {
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
}

function formatTime(h) {
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return `${hour12}:00 ${period}`;
}

function slotLabel(h) {
  return `${formatTime(h)} – ${formatTime(h + 1)}`;
}

function isSlotUnavailable(serviceId, dateKey, hour) {
  const seed = `${serviceId}-${dateKey}-${hour}`.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return seed % 6 === 0;
}

export default function VendorServicesScreen() {
  const { activeMembership } = useAuth();
  const [selected, setSelected] = useState(SERVICES[0]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const id = 'vendor-services-hide-v-scroll';
    if (document.getElementById(id)) return undefined;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '#vendor-services-scroll::-webkit-scrollbar,#vendor-services-scroll *::-webkit-scrollbar{display:none;width:0;height:0;}';
    document.head.appendChild(style);
    return undefined;
  }, []);

  const dateOptions = useMemo(() => {
    const days = [];
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      days.push(d);
    }
    return days;
  }, []);

  const dateKey = toDateKey(selectedDate);

  const slotState = (hour) => {
    if (isSlotUnavailable(selected.id, dateKey, hour)) return 'unavailable';
    if (selectedSlot === hour) return 'selected';
    return 'available';
  };

  const book = () => {
    if (selectedSlot == null) {
      showAlert('Select a slot', 'Please choose a date and time slot for the vendor visit.');
      return;
    }
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      showAlert(
        'Booking requested',
        `${selected.name} visit scheduled for ${formatDayLabel(selectedDate)}, ${slotLabel(selectedSlot)}.\n\nFlat ${activeMembership?.flat || '—'} · Our vendor partner will call you to confirm.`,
        [{ text: 'OK', onPress: () => { setSelectedSlot(null); setNotes(''); } }]
      );
    }, 600);
  };

  return (
    <ScrollView
      nativeID="vendor-services-scroll"
      style={[styles.container, Platform.OS === 'web' && styles.containerWeb]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.subtitle}>Book verified vendors for your flat</Text>

      <Text style={styles.sectionLabel}>Select service</Text>
      <View style={styles.serviceGrid}>
        {SERVICES.map((service) => {
          const active = selected.id === service.id;
          return (
            <TouchableOpacity
              key={service.id}
              onPress={() => { setSelected(service); setSelectedSlot(null); }}
              style={[styles.serviceTile, active && styles.serviceTileActive]}
              activeOpacity={0.88}
            >
              <View style={[styles.serviceIcon, { backgroundColor: service.tint }]}>
                <Ionicons name={service.icon} size={22} color={service.color} />
              </View>
              <Text style={[styles.serviceName, active && styles.serviceNameActive]}>{service.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.detailCard}>
        <Text style={styles.detailTitle}>{selected.name}</Text>
        <Text style={styles.detailDesc}>{selected.desc}</Text>
        <Text style={styles.detailMeta}>Visit at Flat {activeMembership?.flat || '—'} · Society-approved vendors</Text>
      </View>

      <DateScrollRow
        dates={dateOptions}
        selectedKey={dateKey}
        onSelectDate={(d) => { setSelectedDate(d); setSelectedSlot(null); }}
        formatLabel={formatDayLabel}
        scrollNativeId="vendor-date-scroll"
        labelStyle={styles.sectionLabel}
      />

      <Text style={styles.sectionLabel}>Available slots</Text>
      <View style={styles.slotGrid}>
        {SLOT_HOURS.map((h) => {
          const state = slotState(h);
          const disabled = state === 'unavailable';
          return (
            <TouchableOpacity
              key={h}
              disabled={disabled}
              onPress={() => setSelectedSlot(h)}
              style={[
                styles.slot,
                state === 'selected' && styles.slotSelected,
                state === 'unavailable' && styles.slotUnavailable
              ]}
            >
              <Text style={[
                styles.slotText,
                state === 'selected' && styles.slotTextSelected,
                disabled && styles.slotTextDisabled
              ]}>
                {slotLabel(h)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.legend}>
        <LegendItem color="#fff" border={colors.border} label="Available" />
        <LegendItem color="#E5E7EB" label="Unavailable" />
        <LegendItem color={colors.accent} label="Selected" />
      </View>

      <Text style={styles.sectionLabel}>Notes (optional)</Text>
      <TextInput
        style={styles.notesInput}
        placeholder="Describe the issue — e.g. AC not cooling, kitchen tap leaking…"
        value={notes}
        onChangeText={setNotes}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />

      <PrimaryButton
        title="Book vendor visit"
        onPress={book}
        loading={submitting}
        disabled={selectedSlot == null}
      />
      <Text style={styles.note}>Vendor will contact you to confirm the visit.</Text>
    </ScrollView>
  );
}

function LegendItem({ color, border, label }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color, borderColor: border || color, borderWidth: border ? 1 : 0 }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  containerWeb: { scrollbarWidth: 'none', msOverflowStyle: 'none' },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 20 },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm },
  serviceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: spacing.lg },
  serviceTile: {
    width: '30%', flexGrow: 1, minWidth: 96, alignItems: 'center', paddingVertical: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border
  },
  serviceTileActive: { borderColor: colors.accent, backgroundColor: '#EEF4EF' },
  serviceIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  serviceName: { marginTop: 8, fontSize: 11, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },
  serviceNameActive: { color: colors.primary },
  detailCard: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border
  },
  detailTitle: { fontSize: 17, fontWeight: '700', color: colors.primary },
  detailDesc: { fontSize: 13, color: colors.text, marginTop: 4 },
  detailMeta: { fontSize: 12, color: colors.textMuted, marginTop: 8 },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  slot: {
    width: '48%', marginRight: '2%', marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingVertical: 12, paddingHorizontal: 10, backgroundColor: colors.card
  },
  slotSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  slotUnavailable: { backgroundColor: '#E5E7EB', borderColor: '#E5E7EB' },
  slotText: { color: colors.text, fontSize: 12, textAlign: 'center' },
  slotTextSelected: { color: '#fff', fontWeight: '600' },
  slotTextDisabled: { color: '#9CA3AF' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 14, borderRadius: 4 },
  legendText: { fontSize: 12, color: colors.textMuted },
  notesInput: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.lg, fontSize: 15,
    backgroundColor: colors.card, color: colors.text, minHeight: 88
  },
  note: { textAlign: 'center', color: colors.textMuted, fontSize: 12, marginTop: spacing.sm }
});
