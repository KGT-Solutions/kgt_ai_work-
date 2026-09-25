import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import { showAlert } from '../utils/alert';
import MarketplaceListingCard from '../components/MarketplaceListingCard';
import PrimaryButton from '../components/PrimaryButton';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function MyAdsScreen({ navigation }) {
  const { activeBuildingId, activeMembership } = useAuth();
  const buildingId = activeBuildingId || activeMembership?.buildingId;

  const [listings, setListings] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [type, setType] = useState('sale');
  const [loading, setLoading] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!buildingId) return;
    try {
      const data = await api.getMyMarketplaceListings(buildingId);
      setListings(data);
      setError('');
    } catch (e) {
      setListings([]);
      setError(e.message);
    }
  }, [buildingId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (!title.trim()) {
      showAlert('Missing title', 'Please enter what you are listing.');
      return;
    }
    if (!buildingId) {
      showAlert('Session error', 'Building not found. Please log out and sign in again.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.postListing(
        { type, title: title.trim(), price: price ? Number(price) : null },
        buildingId
      );
      setTitle('');
      setPrice('');
      setType('sale');
      setShowForm(false);
      await load();
    } catch (e) {
      showAlert('Could not post', e.message);
    } finally {
      setLoading(false);
    }
  };

  const confirmRemove = async () => {
    if (!pendingRemove || !buildingId) return;

    const item = pendingRemove;
    setPendingRemove(null);
    setRemovingId(item.id);
    setError('');

    try {
      await api.deleteListing(item.id, buildingId);
      await load();
    } catch (e) {
      setError(e.message);
      showAlert('Could not remove', e.message);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.subtitle}>
        Manage items you have listed for sale, rent, or as a service in{' '}
        {activeMembership?.buildingName || 'your society'}.
      </Text>

      {!!error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {showForm ? (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>List an item</Text>
          <View style={styles.typeRow}>
            {['sale', 'rent', 'service'].map((t) => (
              <TouchableOpacity
                key={t}
                style={[styles.typeChip, type === t && styles.typeChipActive]}
                onPress={() => setType(t)}
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
          <TouchableOpacity onPress={() => setShowForm(false)} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <TouchableOpacity
            style={styles.postBtn}
            onPress={() => setShowForm(true)}
            activeOpacity={0.88}
          >
            <View style={styles.postIcon}>
              <Ionicons name="add" size={20} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.postTitle}>List an item</Text>
              <Text style={styles.postMeta}>Sell, rent, or offer a service</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <Text style={styles.sectionLabel}>Your ads ({listings.length})</Text>

          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            {listings.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="storefront-outline" size={40} color={colors.border} />
                <Text style={styles.empty}>You have not posted any ads yet.</Text>
                <Text style={styles.emptyHint}>Tap “List an item” above to get started.</Text>
              </View>
            ) : (
              <View style={styles.grid}>
                {listings.map((item) => (
                  <View key={item.id} style={styles.cardWrap}>
                    <MarketplaceListingCard item={item} style={{ width: '100%' }} />
                    <Pressable
                      style={({ pressed }) => [
                        styles.removeBtn,
                        removingId === item.id && styles.removeBtnDisabled,
                        pressed && styles.removeBtnPressed
                      ]}
                      onPress={() => setPendingRemove(item)}
                      disabled={removingId === item.id}
                    >
                      <Ionicons name="trash-outline" size={14} color={colors.error} />
                      <Text style={styles.removeText}>
                        {removingId === item.id ? 'Removing…' : 'Remove'}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
        </>
      )}

      <Modal visible={!!pendingRemove} transparent animationType="fade" onRequestClose={() => setPendingRemove(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Remove listing?</Text>
            <Text style={styles.modalBody}>
              {pendingRemove ? `"${pendingRemove.title}" will be removed from the marketplace.` : ''}
            </Text>
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setPendingRemove(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalConfirm} onPress={confirmRemove}>
                <Text style={styles.modalConfirmText}>Remove</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', padding: spacing.lg },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.lg
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginBottom: spacing.md
  },
  errorText: { color: colors.error, fontSize: 13, fontWeight: '500' },
  postBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    shadowColor: '#2B3A4A',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2
  },
  postIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  postTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  postMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm
  },
  list: { paddingBottom: spacing.xl },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between'
  },
  cardWrap: { width: '48%', marginBottom: spacing.md },
  removeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 8,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: '#FEF2F2',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {})
  },
  removeBtnPressed: { opacity: 0.75 },
  removeBtnDisabled: { opacity: 0.6 },
  removeText: { fontSize: 12, fontWeight: '600', color: colors.error },
  emptyWrap: { alignItems: 'center', paddingTop: spacing.xl },
  empty: { marginTop: spacing.md, fontWeight: '600', color: colors.text },
  emptyHint: { marginTop: 4, fontSize: 13, color: colors.textMuted },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    shadowColor: '#2B3A4A',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2
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
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  typeTextActive: { color: '#fff' },
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
  cancelBtn: { alignItems: 'center', marginTop: spacing.md },
  cancelText: { color: colors.textMuted, fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.primary, marginBottom: 8 },
  modalBody: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.lg },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {})
  },
  modalCancelText: { color: colors.textMuted, fontWeight: '600' },
  modalConfirm: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    backgroundColor: colors.error,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } : {})
  },
  modalConfirmText: { color: '#fff', fontWeight: '700' }
});
