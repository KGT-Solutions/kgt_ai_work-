import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { showAlert, showSuccess } from '../utils/alert';
import PrimaryButton from '../components/PrimaryButton';
import DateScrollRow from '../components/DateScrollRow';
import HorizontalScrollRow from '../components/HorizontalScrollRow';
import ResidentScreenHeader from '../components/ResidentScreenHeader';
import { SkeletonList } from '../components/Skeleton';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const TABS = [
  { key: 'book', label: 'Book' },
  { key: 'active', label: 'Active' },
  { key: 'past', label: 'Past' }
];
const ICONS = {
  clubhouse: 'business-outline',
  tennis: 'tennisball-outline',
  party: 'sparkles-outline',
  gym: 'barbell-outline',
  pool: 'water-outline',
  garden: 'leaf-outline',
  default: 'grid-outline'
};

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
  return `${String(hour12).padStart(2, '0')}:00 ${period}`;
}

function slotRangeLabel(startHour) {
  return `${formatTime(startHour)} – ${formatTime(startHour + 1)}`;
}

function formatBookingWhen(start, end) {
  const s = new Date(start);
  const e = new Date(end);
  const date = s.toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short'
  });
  const startLabel = s.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const endLabel = e.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${startLabel} – ${endLabel}`;
}

function statusMeta(status) {
  if (status === 'approved') return { label: 'Approved', bg: '#cdf3e2', fg: '#0a7a55' };
  if (status === 'pending') return { label: 'Pending', bg: '#f4ead1', fg: '#8a6a2f' };
  if (status === 'rejected') return { label: 'Declined', bg: '#fcecea', fg: '#c2503f' };
  if (status === 'cancelled') return { label: 'Cancelled', bg: '#E5E7EB', fg: '#6B7280' };
  return { label: status, bg: '#dbeee5', fg: '#4f7a67' };
}

function isActiveBooking(b, now = new Date()) {
  return ['pending', 'approved'].includes(b.status) && new Date(b.endTime) > now;
}

/** Slot starting at `hour` on `date` is bookable only if it has not started yet. */
function isSlotPast(date, hour, now = new Date()) {
  const start = new Date(date);
  start.setHours(hour, 0, 0, 0);
  return start <= now;
}

export default function FacilityBookingScreen({ navigation }) {
  const { activeBuildingId, activeMembership } = useAuth();
  const [tab, setTab] = useState('book');
  const [facilities, setFacilities] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [bookings, setBookings] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [slotLoading, setSlotLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);

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

  const loadFacilities = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getFacilities(activeBuildingId);
      setFacilities(data);
      setSelected((prev) => {
        if (prev && data.find((f) => f.id === prev.id)) return prev;
        return data[0] || null;
      });
    } catch {
      setFacilities([]);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }, [activeBuildingId]);

  const loadMyBookings = useCallback(async () => {
    if (!activeBuildingId) return;
    setListLoading(true);
    try {
      setMyBookings(await api.getMyFacilityBookings(activeBuildingId));
    } catch {
      setMyBookings([]);
    } finally {
      setListLoading(false);
    }
  }, [activeBuildingId]);

  const loadAvailability = useCallback(async () => {
    if (!selected) return;
    setSlotLoading(true);
    setSelectedSlot(null);
    try {
      const data = await api.getFacilityAvailability(selected.id, toDateKey(selectedDate), activeBuildingId);
      setBookings(data);
    } catch {
      setBookings([]);
    } finally {
      setSlotLoading(false);
    }
  }, [selected, selectedDate, activeBuildingId]);

  useEffect(() => { loadFacilities(); }, [loadFacilities]);
  useEffect(() => { loadAvailability(); }, [loadAvailability]);
  useEffect(() => {
    if (tab === 'active' || tab === 'past') loadMyBookings();
  }, [tab, loadMyBookings]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const id = 'facility-booking-hide-v-scroll';
    if (document.getElementById(id)) return undefined;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '#facility-booking-scroll::-webkit-scrollbar,#facility-booking-scroll *::-webkit-scrollbar{display:none;width:0;height:0;}';
    document.head.appendChild(style);
    return undefined;
  }, []);

  const activeBookings = useMemo(
    () => myBookings.filter((b) => isActiveBooking(b)).sort((a, b) => new Date(a.startTime) - new Date(b.startTime)),
    [myBookings]
  );
  const pastBookings = useMemo(
    () => myBookings.filter((b) => !isActiveBooking(b)).sort((a, b) => new Date(b.startTime) - new Date(a.startTime)),
    [myBookings]
  );

  const availableHours = useMemo(
    () => HOURS.filter((h) => !isSlotPast(selectedDate, h)),
    [selectedDate]
  );

  useEffect(() => {
    if (selectedSlot != null && isSlotPast(selectedDate, selectedSlot)) {
      setSelectedSlot(null);
    }
  }, [selectedDate, selectedSlot]);

  const slotState = (hour) => {
    const start = new Date(selectedDate);
    start.setHours(hour, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const hit = bookings.find((b) => {
      const bs = new Date(b.startTime);
      const be = new Date(b.endTime);
      return bs < end && be > start;
    });
    if (hit) return hit.status === 'approved' ? 'booked' : 'pending';
    if (selectedSlot === hour) return 'selected';
    return 'available';
  };

  const confirm = async () => {
    if (!selected || selectedSlot == null) return;
    if (isSlotPast(selectedDate, selectedSlot)) {
      showAlert('Slot unavailable', 'That time has already passed. Please choose a later slot.');
      setSelectedSlot(null);
      return;
    }
    setSubmitting(true);
    try {
      const startTime = new Date(selectedDate);
      startTime.setHours(selectedSlot, 0, 0, 0);
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000);
      await api.bookFacility(selected.id, { startTime, endTime }, activeBuildingId);
      setSelectedSlot(null);
      await showSuccess(
        'Your booking request has been sent to the building admin for approval.',
        'Booking requested'
      );
      setTab('active');
      loadMyBookings();
      loadAvailability();
    } catch (e) {
      showAlert('Booking failed', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const cancelBooking = (booking) => {
    showAlert(
      'Cancel booking?',
      `Cancel your request for ${booking.facility?.name || 'this facility'} on ${formatBookingWhen(booking.startTime, booking.endTime)}?`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Cancel booking',
          style: 'destructive',
          onPress: async () => {
            setCancellingId(booking.id);
            try {
              await api.cancelFacilityBooking(booking.id, activeBuildingId);
              await showSuccess('Your booking has been cancelled.', 'Cancelled');
              await loadMyBookings();
              if (selected?.id === booking.facilityId) loadAvailability();
            } catch (e) {
              showAlert('Could not cancel', e.message);
            } finally {
              setCancellingId(null);
            }
          }
        }
      ]
    );
  };

  const renderTabs = () => (
    <View style={styles.segment}>
      {TABS.map(({ key, label }) => {
        const active = tab === key;
        return (
          <TouchableOpacity
            key={key}
            style={[styles.segButton, active && styles.segActive]}
            onPress={() => setTab(key)}
            activeOpacity={0.88}
          >
            <Text style={[styles.segText, active && styles.segTextActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderBookingList = (items, emptyTitle, emptyHint) => {
    if (listLoading) {
      return <SkeletonList count={3} />;
    }
    if (items.length === 0) {
      return (
        <View style={styles.emptyBox}>
          <Ionicons name="calendar-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>{emptyTitle}</Text>
          <Text style={styles.emptyText}>{emptyHint}</Text>
        </View>
      );
    }
    return items.map((b) => {
      const st = statusMeta(b.status);
      const canCancel = isActiveBooking(b);
      return (
        <View key={b.id} style={styles.bookingCard}>
          <View style={styles.bookingIcon}>
            <Ionicons name="calendar-outline" size={20} color={colors.accent} />
          </View>
          <View style={styles.bookingBody}>
            <Text style={styles.bookingName}>{b.facility?.name || 'Facility'}</Text>
            <Text style={styles.bookingWhen}>{formatBookingWhen(b.startTime, b.endTime)}</Text>
            {b.facility?.pricePerHour != null ? (
              <Text style={styles.bookingMeta}>₹{b.facility.pricePerHour} per hour</Text>
            ) : null}
            <View style={[styles.badge, { backgroundColor: st.bg }]}>
              <Text style={[styles.badgeText, { color: st.fg }]}>{st.label}</Text>
            </View>
            {canCancel ? (
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => cancelBooking(b)}
                disabled={cancellingId === b.id}
                activeOpacity={0.85}
              >
                {cancellingId === b.id ? (
                  <ActivityIndicator size="small" color={colors.error} />
                ) : (
                  <Text style={styles.cancelBtnText}>Cancel booking</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      );
    });
  };

  const locationLabel = [
    activeMembership?.buildingName,
    activeMembership?.flat
  ].filter(Boolean).join(' · ') || 'Your society';

  const header = (
    <ResidentScreenHeader
      navigation={navigation}
      title="Book a facility"
      locationLabel={locationLabel}
      showBack
    />
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {header}
        <ScrollView
          nativeID="facility-booking-scroll"
          style={[styles.scroll, Platform.OS === 'web' && styles.containerWeb]}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.body}>
            {renderTabs()}
            <SkeletonList count={4} />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {header}
      <ScrollView
        nativeID="facility-booking-scroll"
        style={[styles.scroll, Platform.OS === 'web' && styles.containerWeb]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.body}>
          {renderTabs()}

        {tab === 'active' && renderBookingList(
          activeBookings,
          'No active bookings',
          'Approved and pending requests will show here until the slot ends.'
        )}

        {tab === 'past' && renderBookingList(
          pastBookings,
          'No past bookings',
          'Completed, declined, and cancelled bookings will appear here.'
        )}

        {tab === 'book' && facilities.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="calendar-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No facilities available yet</Text>
            <Text style={styles.emptyText}>Your building admin can add bookable amenities from the admin panel.</Text>
          </View>
        )}

        {tab === 'book' && facilities.length > 0 && (
          <>
            <HorizontalScrollRow
              label="Select facility"
              labelStyle={styles.sectionLabel}
              scrollNativeId="facility-chip-scroll"
              scrollStep={130}
              style={styles.facilityRow}
            >
              {facilities.map((f) => {
                const active = selected?.id === f.id;
                return (
                  <TouchableOpacity key={f.id} onPress={() => setSelected(f)}>
                    <View style={[styles.facilityCard, active && styles.facilityCardActive]}>
                      <Ionicons name={ICONS[f.icon] || ICONS.default} size={28} color={active ? colors.accent : colors.textMuted} />
                      <Text style={[styles.facilityName, active && styles.facilityNameActive]}>{f.name}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </HorizontalScrollRow>

            {selected && (
              <>
                <View style={styles.detailRow}>
                  <View style={styles.detailIcon}>
                    <Ionicons name={ICONS[selected.icon] || ICONS.default} size={22} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detailName}>{selected.name}</Text>
                    <Text style={styles.detailMeta}>
                      {selected.capacity ? `Capacity: ${selected.capacity} people` : 'Capacity not set'}
                      {selected.pricePerHour != null ? ` · ₹${selected.pricePerHour} per hour` : ' · Free'}
                    </Text>
                    {selected.description ? <Text style={styles.detailDesc}>{selected.description}</Text> : null}
                  </View>
                </View>

                <DateScrollRow
                  dates={dateOptions}
                  selectedKey={toDateKey(selectedDate)}
                  onSelectDate={setSelectedDate}
                  formatLabel={formatDayLabel}
                  scrollNativeId="facility-date-scroll"
                  labelStyle={styles.sectionLabel}
                />

                <Text style={styles.sectionLabel}>Select time slot</Text>
                {slotLoading ? (
                  <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} />
                ) : availableHours.length === 0 ? (
                  <View style={styles.noSlotsBox}>
                    <Text style={styles.noSlotsText}>No upcoming slots left for this day. Pick another date.</Text>
                  </View>
                ) : (
                  <View style={styles.slotGrid}>
                    {availableHours.map((h, index) => {
                      const state = slotState(h);
                      const disabled = state === 'booked' || state === 'pending';
                      const isLastOdd = index === availableHours.length - 1 && availableHours.length % 2 === 1;
                      return (
                        <TouchableOpacity
                          key={h}
                          disabled={disabled}
                          onPress={() => setSelectedSlot(h)}
                          style={[
                            styles.slot,
                            state === 'selected' && styles.slotSelected,
                            state === 'booked' && styles.slotBooked,
                            state === 'pending' && styles.slotPending,
                            isLastOdd && styles.slotWide
                          ]}
                        >
                          <Text style={[
                            styles.slotText,
                            state === 'selected' && styles.slotTextSelected,
                            disabled && styles.slotTextDisabled
                          ]}>
                            {slotRangeLabel(h)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <View style={styles.legend}>
                  <LegendItem color="#fff" border={colors.border} label="Available" />
                  <LegendItem color="#E5E7EB" label="Booked" />
                  <LegendItem color={colors.accent} label="Selected" />
                </View>

                <PrimaryButton
                  title="Request booking"
                  onPress={confirm}
                  loading={submitting}
                  disabled={selectedSlot == null}
                />
                <Text style={styles.note}>Bookings require admin approval before they are confirmed.</Text>
              </>
            )}
          </>
        )}
      </View>
      </ScrollView>
    </View>
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
  scroll: { flex: 1, backgroundColor: 'transparent' },
  containerWeb: { scrollbarWidth: 'none', msOverflowStyle: 'none' },
  content: { paddingBottom: spacing.xl, flexGrow: 1 },
  body: { paddingHorizontal: spacing.lg },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.track,
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.lg
  },
  segButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center'
  },
  segActive: { backgroundColor: colors.accent },
  segText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  segTextActive: { color: '#fff' },
  facilityRow: { marginBottom: spacing.md },
  facilityCard: {
    width: 110, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, marginRight: spacing.sm,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center'
  },
  facilityCardActive: { borderColor: colors.accent, backgroundColor: '#EEF4EF' },
  facilityName: { marginTop: spacing.sm, fontSize: 12, fontWeight: '600', color: colors.textMuted, textAlign: 'center' },
  facilityNameActive: { color: colors.primary },
  detailRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg, alignItems: 'flex-start' },
  detailIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEF4EF',
    alignItems: 'center', justifyContent: 'center'
  },
  detailName: { fontSize: 18, fontWeight: '700', color: colors.primary },
  detailMeta: { color: colors.textMuted, marginTop: 4, fontSize: 13 },
  detailDesc: { color: colors.text, marginTop: 6, fontSize: 13, lineHeight: 18 },
  sectionLabel: { fontSize: 14, fontWeight: '600', color: colors.primary, marginBottom: spacing.sm },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  slot: {
    width: '48%', marginRight: '2%', marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingVertical: 12, paddingHorizontal: 10, backgroundColor: colors.card
  },
  slotWide: { width: '100%', marginRight: 0 },
  slotSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  slotBooked: { backgroundColor: '#E5E7EB', borderColor: '#E5E7EB' },
  slotPending: { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
  slotText: { color: colors.text, fontSize: 12, textAlign: 'center' },
  slotTextSelected: { color: '#fff', fontWeight: '600' },
  slotTextDisabled: { color: '#9CA3AF' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginBottom: spacing.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 14, height: 14, borderRadius: 4 },
  legendText: { fontSize: 12, color: colors.textMuted },
  note: { textAlign: 'center', color: colors.textMuted, fontSize: 12, marginTop: spacing.sm },
  noSlotsBox: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md
  },
  noSlotsText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
  emptyBox: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.xl,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, marginTop: spacing.md },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 20 },
  bookingCard: {
    flexDirection: 'row',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm
  },
  bookingIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft,
    alignItems: 'center', justifyContent: 'center'
  },
  bookingBody: { flex: 1 },
  bookingName: { fontSize: 15, fontWeight: '700', color: colors.primaryInk },
  bookingWhen: { fontSize: 13, color: colors.textBody, marginTop: 4 },
  bookingMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  badge: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  cancelBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 2
  },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: colors.error }
});
