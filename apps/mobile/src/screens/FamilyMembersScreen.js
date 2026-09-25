import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Modal, Pressable, Platform
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, layout } from '../theme';
import { showAlert } from '../utils/alert';
import PrimaryButton from '../components/PrimaryButton';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const RELATIONS = ['Spouse', 'Child', 'Parent', 'Sibling', 'Other'];

const STATUS_STYLE = {
  pending: { bg: '#FFFBF5', color: '#D98E3B' },
  approved: { bg: '#E8F0E9', color: '#4A7C59' },
  rejected: { bg: '#FEF2F2', color: '#B4483A' },
  revoked: { bg: '#F3F4F6', color: '#6B7280' }
};

function StatusBadge({ status, label }) {
  const style = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return (
    <View style={[styles.badge, { backgroundColor: style.bg }]}>
      <Text style={[styles.badgeText, { color: style.color }]}>{label}</Text>
    </View>
  );
}

export default function FamilyMembersScreen() {
  const { activeBuildingId, activeMembership, activeMembershipId, user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState(null);
  const [name, setName] = useState('');
  const [relation, setRelation] = useState(RELATIONS[0]);
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const isMaster = overview?.isMaster ?? activeMembership?.isFlatMaster;

  const load = useCallback(async () => {
    if (!activeBuildingId) return;
    setOverview(await api.getFamilyOverview(activeBuildingId));
  }, [activeBuildingId, activeMembershipId]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const resetAddForm = () => {
    setName('');
    setPhone('');
    setPassword('');
    setRelation(RELATIONS[0]);
  };

  const add = async () => {
    if (!name.trim() || phone.replace(/\D/g, '').length !== 10 || password.length < 6) {
      showAlert('Missing details', 'Enter name, 10-digit phone, and password (min 6 characters).');
      return;
    }
    setLoading(true);
    try {
      await api.addFamilyMember({
        name: name.trim(),
        relation,
        phone: `+91${phone.replace(/\D/g, '')}`,
        password
      }, activeBuildingId);
      resetAddForm();
      setShowAdd(false);
      await load();
      showAlert('Member added', 'They can sign in now with their phone number and password.');
    } catch (e) {
      showAlert('Could not add', e.message);
    } finally {
      setLoading(false);
    }
  };

  const cancelRequest = (item) => {
    showAlert('Cancel request', `Remove the request for ${item.name}?`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await api.deleteFamilyMember(item.id, activeBuildingId);
          await load();
        }
      }
    ]);
  };

  const revoke = (item) => {
    showAlert('Revoke access', `Remove app access for ${item.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          await api.revokeFamilyMember(item.id, activeBuildingId);
          await load();
        }
      }
    ]);
  };

  const savePassword = async () => {
    if (newPassword.length < 6) {
      showAlert('Invalid password', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      await api.changeFamilyPassword(passwordTarget.id, newPassword, activeBuildingId);
      setPasswordTarget(null);
      setNewPassword('');
      showAlert('Password updated', `Login password changed for ${passwordTarget.name}.`);
    } catch (e) {
      showAlert('Could not update', e.message);
    } finally {
      setLoading(false);
    }
  };

  const masterName = overview?.master?.name || user?.name;
  const flatLabel = overview?.flatNumber ? `Flat ${overview.flatNumber}` : activeMembership?.flat ? `Flat ${activeMembership.flat}` : 'Your flat';
  const members = overview?.members || [];

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.flatTitle}>{flatLabel}</Text>

        <View style={styles.masterCard}>
          <View style={styles.masterIcon}>
            <Ionicons name="shield-checkmark" size={22} color="#6B5089" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.masterLabel}>Master user</Text>
            <Text style={styles.masterName}>{masterName}</Text>
            {overview?.master?.phone && (
              <Text style={styles.masterPhone}>{overview.master.phone}</Text>
            )}
            {isMaster && (
              <Text style={styles.masterHint}>You can add and manage family members for this flat.</Text>
            )}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Family members ({members.length})</Text>

        {!isMaster && (
          <Text style={styles.viewOnlyHint}>View only — contact the master user to add or manage members.</Text>
        )}

        {members.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Ionicons name="people-outline" size={36} color={colors.border} />
            <Text style={styles.empty}>No family members added yet.</Text>
          </View>
        ) : (
          members.map((item) => (
            <View key={item.id} style={styles.card}>
              <View style={{ flex: 1 }}>
                <View style={styles.cardTop}>
                  <Text style={styles.cardName}>{item.name}</Text>
                  <StatusBadge status={item.status} label={item.statusLabel} />
                </View>
                <Text style={styles.cardMeta}>{item.relation} · {item.phone}</Text>
              </View>
              {isMaster && item.status === 'pending' && (
                <TouchableOpacity onPress={() => cancelRequest(item)}>
                  <Text style={styles.actionDanger}>Cancel</Text>
                </TouchableOpacity>
              )}
              {isMaster && item.status === 'approved' && (
                <View style={styles.actions}>
                  <TouchableOpacity onPress={() => { setPasswordTarget(item); setNewPassword(''); }}>
                    <Text style={styles.action}>Password</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => revoke(item)}>
                    <Text style={styles.actionDanger}>Revoke</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>

      {isMaster && (
        <Pressable style={styles.fab} onPress={() => setShowAdd(true)}>
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      )}

      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={styles.sheetBackdrop}>
          <Pressable style={styles.sheetDismiss} onPress={() => { setShowAdd(false); resetAddForm(); }} />
          <View style={styles.sheetCard}>
            <Text style={styles.modalTitle}>Add family member</Text>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <TextInput style={styles.input} placeholder="Full name" value={name} onChangeText={setName} />
              <View style={styles.chipRow}>
                {RELATIONS.map((r) => (
                  <TouchableOpacity key={r} onPress={() => setRelation(r)} style={[styles.chip, relation === r && styles.chipActive]}>
                    <Text style={relation === r ? styles.chipTextActive : styles.chipText}>{r}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.phoneRow}>
                <Text style={styles.prefix}>+91</Text>
                <TextInput style={styles.phoneInput} placeholder="Phone" keyboardType="number-pad" value={phone} onChangeText={setPhone} maxLength={10} />
              </View>
              <TextInput style={styles.input} placeholder="App password (min 6 chars)" value={password} onChangeText={setPassword} secureTextEntry />
              <PrimaryButton title="Add family member" onPress={add} loading={loading} />
              <TouchableOpacity onPress={() => { setShowAdd(false); resetAddForm(); }} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={!!passwordTarget} transparent animationType="fade" onRequestClose={() => setPasswordTarget(null)}>
        <View style={styles.centerBackdrop}>
          <View style={styles.centerCard}>
            <Text style={styles.modalTitle}>Change password</Text>
            <Text style={styles.modalBody}>Set a new login password for {passwordTarget?.name}.</Text>
            <TextInput
              style={styles.input}
              placeholder="New password (min 6 characters)"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />
            <PrimaryButton title="Update password" onPress={savePassword} loading={loading} />
            <TouchableOpacity onPress={() => setPasswordTarget(null)} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: spacing.lg, paddingBottom: 100 },
  flatTitle: { fontSize: 13, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm },
  masterCard: {
    flexDirection: 'row', gap: spacing.md, backgroundColor: colors.card,
    borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg,
    borderWidth: 1, borderColor: '#E8E0F0'
  },
  masterIcon: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: '#F3EDFA',
    alignItems: 'center', justifyContent: 'center'
  },
  masterLabel: { fontSize: 11, fontWeight: '700', color: '#6B5089', textTransform: 'uppercase', letterSpacing: 0.6 },
  masterName: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 2 },
  masterPhone: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  masterHint: { fontSize: 12, color: colors.accent, marginTop: 8, lineHeight: 18 },
  sectionLabel: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm
  },
  viewOnlyHint: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
  emptyWrap: { alignItems: 'center', paddingVertical: spacing.xl },
  empty: { marginTop: spacing.md, color: colors.textMuted, fontWeight: '600' },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border, gap: 8
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  cardName: { fontWeight: '700', color: colors.text, flex: 1 },
  cardMeta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '700' },
  actions: { alignItems: 'flex-end', gap: 6 },
  action: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  actionDanger: { color: colors.error, fontSize: 12, fontWeight: '600' },
  fab: {
    position: 'absolute', right: spacing.lg, bottom: spacing.lg,
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#2B3A4A', shadowOpacity: 0.25, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 6
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
    ...(Platform.OS === 'web' ? { marginBottom: 0, borderRadius: radius.lg, margin: spacing.lg } : null)
  },
  centerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 35, 26, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg
  },
  centerCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.primary, marginBottom: 8 },
  modalBody: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.md },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, marginBottom: spacing.md, fontSize: 16, backgroundColor: colors.background
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, marginRight: 8, marginBottom: 8 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: '600', fontSize: 13 },
  phoneRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, marginBottom: spacing.md, backgroundColor: colors.background
  },
  prefix: { fontSize: 16, color: colors.text, marginRight: spacing.sm, fontWeight: '500' },
  phoneInput: { flex: 1, paddingVertical: spacing.md, fontSize: 16, color: colors.text },
  cancelBtn: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.sm },
  cancelText: { color: colors.textMuted, fontWeight: '600' }
});
