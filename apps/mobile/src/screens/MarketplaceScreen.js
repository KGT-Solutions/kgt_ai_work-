import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  Modal,
  Pressable
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, layout, shadow } from '../theme';
import { showAlert } from '../utils/alert';
import MarketplaceListingCard from '../components/MarketplaceListingCard';
import PrimaryButton from '../components/PrimaryButton';
import { DUMMY_MARKETPLACE_LISTINGS, MARKETPLACE_FILTERS } from '../data/dummyMarketplace';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

/** Tokens from design-system.md (Emerald Fresh) */
const ds = {
  surface: '#ffffff',
  primary: '#059669',
  heading: '#06231a',
  secondary: '#2f5c4a',
  muted: '#7ba392',
  onPrimary: '#ffffff'
};

function mergeListings(apiListings) {
  const live = (apiListings || []).map((l) => ({ ...l, isLive: true }));
  if (live.length === 0) return DUMMY_MARKETPLACE_LISTINGS;
  return live;
}

export default function MarketplaceScreen({ navigation }) {
  const { activeBuildingId, activeMembership } = useAuth();
  const [listings, setListings] = useState(DUMMY_MARKETPLACE_LISTINGS);
  const [filter, setFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [type, setType] = useState('sale');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getMarketplace(activeBuildingId);
      setListings(mergeListings(data));
    } catch {
      setListings(DUMMY_MARKETPLACE_LISTINGS);
    }
  }, [activeBuildingId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = filter === 'all'
    ? listings
    : listings.filter((l) => l.type === filter);

  const resetForm = () => {
    setTitle('');
    setPrice('');
    setType('sale');
  };

  const submit = async () => {
    if (!title.trim()) {
      showAlert('Missing title', 'Please enter what you are listing.');
      return;
    }
    setLoading(true);
    try {
      await api.postListing(
        { type, title: title.trim(), price: price ? Number(price) : null },
        activeBuildingId
      );
      resetForm();
      setShowForm(false);
      await load();
    } catch (e) {
      showAlert('Could not post', e.message);
    } finally {
      setLoading(false);
    }
  };

  const locationLabel = [
    activeMembership?.buildingName,
    activeMembership?.flat
  ].filter(Boolean).join(' · ') || 'Your society';

  const topPad = Platform.OS === 'android'
    ? (StatusBar.currentHeight || 12)
    : Platform.OS === 'web'
      ? 16
      : 8;

  return (
    <View style={styles.container}>
      <FlatList
        data={filtered}
        numColumns={2}
        keyExtractor={(l) => l.id}
        columnWrapperStyle={styles.row}
        contentContainerStyle={[styles.list, { paddingTop: topPad + 8 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={(
          <>
            <View style={styles.topBar}>
              <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
                <Ionicons name="chevron-back" size={22} color={ds.heading} />
              </TouchableOpacity>
              <View style={styles.locationPill}>
                <Ionicons name="business-outline" size={14} color={ds.primary} />
                <Text style={styles.locationText} numberOfLines={1}>{locationLabel}</Text>
              </View>
              <TouchableOpacity
                onPress={() => navigation.navigate('Notifications')}
                style={styles.bellBtn}
                accessibilityRole="button"
                accessibilityLabel="Notifications"
              >
                <Ionicons name="notifications-outline" size={20} color={ds.heading} />
              </TouchableOpacity>
            </View>

            <View style={styles.titleRow}>
              <Ionicons name="storefront-outline" size={22} color={ds.primary} style={styles.titleIcon} />
              <View style={styles.titleBody}>
                <Text style={styles.title}>Marketplace</Text>
                <Text style={styles.subtitle}>Buy, sell, rent or hire within your society.</Text>
              </View>
            </View>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filters}
              style={styles.filtersScroll}
            >
              {MARKETPLACE_FILTERS.map((f) => (
                <TouchableOpacity
                  key={f.key}
                  style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
                  onPress={() => setFilter(f.key)}
                  activeOpacity={0.88}
                >
                  <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        )}
        ListEmptyComponent={(
          <View style={styles.emptyWrap}>
            <Ionicons name="storefront-outline" size={36} color={colors.border} />
            <Text style={styles.empty}>No listings in this category.</Text>
          </View>
        )}
        renderItem={({ item }) => <MarketplaceListingCard item={item} />}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowForm(true)}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel="Post a listing"
      >
        <Ionicons name="add" size={28} color={ds.onPrimary} />
      </TouchableOpacity>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => setShowForm(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetBackdrop}
        >
          <Pressable style={styles.sheetDismiss} onPress={() => { setShowForm(false); resetForm(); }} />
          <View style={styles.sheetCard}>
            <Text style={styles.formTitle}>Post a listing</Text>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={styles.typeRow}>
                {['sale', 'rent', 'service'].map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.typeChip, type === t && styles.typeChipActive]}
                    onPress={() => setType(t)}
                    activeOpacity={0.88}
                  >
                    <Text style={[styles.typeText, type === t && styles.typeTextActive]}>
                      {t === 'sale' ? 'For sale' : t === 'rent' ? 'For rent' : 'Service'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Item or service title"
                value={title}
                onChangeText={setTitle}
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={styles.input}
                placeholder="Price (₹)"
                value={price}
                onChangeText={setPrice}
                keyboardType="numeric"
                placeholderTextColor={colors.textMuted}
              />
              <PrimaryButton title="Publish listing" onPress={submit} loading={loading} />
              <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  list: { paddingHorizontal: 20, paddingBottom: 120 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    gap: 10
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: ds.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft
  },
  locationPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: ds.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    ...shadow.soft
  },
  locationText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    color: ds.secondary
  },
  bellBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: ds.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 18
  },
  titleIcon: { marginRight: 8, marginTop: 4 },
  titleBody: { flex: 1 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: ds.heading,
    letterSpacing: -0.5
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: ds.muted,
    marginTop: 4,
    lineHeight: 17
  },
  filtersScroll: { flexGrow: 0, marginBottom: spacing.md },
  filters: { gap: 8, paddingRight: spacing.md },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: ds.surface,
    ...shadow.soft
  },
  filterChipActive: { backgroundColor: ds.primary },
  filterText: { fontSize: 12, fontWeight: '600', color: ds.muted },
  filterTextActive: { color: ds.onPrimary },
  row: { justifyContent: 'space-between', marginBottom: 14 },
  emptyWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  empty: { marginTop: spacing.md, color: colors.textMuted, fontWeight: '600', textAlign: 'center' },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: ds.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#063c28',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 35, 26, 0.45)',
    justifyContent: 'flex-end',
    alignItems: 'center'
  },
  sheetDismiss: { ...StyleSheet.absoluteFillObject },
  sheetCard: {
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 360 : layout.desktopMaxWidth,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '85%',
    ...(Platform.OS === 'web' ? { margin: spacing.lg, borderRadius: radius.lg } : null)
  },
  formTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.md
  },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.border
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeText: { fontSize: 12, fontWeight: '600', color: ds.secondary },
  typeTextActive: { color: ds.onPrimary },
  input: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    marginBottom: spacing.sm
  },
  cancelBtn: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.sm },
  cancelText: { color: colors.textMuted, fontWeight: '600' }
});
