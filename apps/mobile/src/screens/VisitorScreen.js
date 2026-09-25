import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Modal, TextInput, TouchableOpacity,
  Image, Platform, ScrollView
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors, spacing, radius, layout } from '../theme';
import { showAlert } from '../utils/alert';
import { ScreenHeader } from '../components/ScreenShell';
import ResidentScreenHeader from '../components/ResidentScreenHeader';
import Card from '../components/Card';
import StatusPill from '../components/StatusPill';
import PrimaryButton from '../components/PrimaryButton';
import { api, mediaUrl } from '../api/client';
import { useAuth } from '../context/AuthContext';

const STATUS = {
  pending: { label: 'Pending approval', variant: 'warning' },
  inside: { label: 'Inside', variant: 'success' },
  declined: { label: 'Declined', variant: 'error' },
  exited: { label: 'Exited', variant: 'neutral' }
};

export default function VisitorScreen({ navigation }) {
  const { activeBuildingId, activeMembership, activeMembershipId } = useAuth();
  const isGuard = activeMembership?.role === 'guard';
  const [visitors, setVisitors] = useState([]);
  const [sosAlerts, setSosAlerts] = useState([]);
  const [flats, setFlats] = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('Guest');
  const [flatNumber, setFlatNumber] = useState('');
  const [flatQuery, setFlatQuery] = useState('');
  const [showFlatSuggestions, setShowFlatSuggestions] = useState(false);
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [photo, setPhoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!activeBuildingId) return;
    const tasks = [api.getVisitors(activeBuildingId)];
    if (isGuard) {
      tasks.push(api.getActiveSosAlerts(activeBuildingId).catch(() => []));
      tasks.push(api.getVisitorFlats(activeBuildingId).catch(() => []));
    }
    const [visitorList, alerts, flatList] = await Promise.all(tasks);
    setVisitors(visitorList);
    if (isGuard) {
      setSosAlerts(alerts || []);
      setFlats(flatList || []);
    }
  }, [activeBuildingId, activeMembershipId, isGuard]);

  useFocusEffect(useCallback(() => {
    load().catch(() => {});
    if (!isGuard) return undefined;
    const timer = setInterval(() => {
      api.getActiveSosAlerts(activeBuildingId).then(setSosAlerts).catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [load, isGuard, activeBuildingId]));

  const flatSuggestions = useMemo(() => {
    const q = flatQuery.trim().toUpperCase();
    if (!q) return flats.slice(0, 12);
    return flats.filter((f) => f.number.toUpperCase().includes(q) || f.wing?.toUpperCase?.().includes(q)).slice(0, 12);
  }, [flats, flatQuery]);

  const resetForm = () => {
    setName('');
    setPurpose('Guest');
    setFlatNumber('');
    setFlatQuery('');
    setVehicleNumber('');
    setPhoto(null);
    setError('');
    setShowFlatSuggestions(false);
  };

  const save = async () => {
    setError('');
    setLoading(true);
    try {
      await api.logVisitor(
        {
          visitorName: name,
          purpose,
          flatNumber: flatNumber || flatQuery,
          vehicleNumber: vehicleNumber.trim() || undefined
        },
        activeBuildingId,
        photo
      );
      setModalVisible(false);
      resetForm();
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const markExit = async (id) => {
    await api.markVisitorExit(id, activeBuildingId);
    await load();
  };

  const ackSos = async (id) => {
    try {
      await api.acknowledgeSos(id, activeBuildingId);
      setSosAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // ignore
    }
  };

  const capturePhoto = async () => {
    try {
      if (Platform.OS !== 'web') {
        const cam = await ImagePicker.requestCameraPermissionsAsync();
        if (!cam.granted) {
          showAlert('Permission needed', 'Allow camera access to photograph the visitor.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          quality: 0.7,
          aspect: [3, 4]
        });
        if (!result.canceled && result.assets[0]) setPhoto(result.assets[0]);
        return;
      }

      const lib = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!lib.granted) {
        showAlert('Permission needed', 'Allow photo access to attach a visitor photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7
      });
      if (!result.canceled && result.assets[0]) setPhoto(result.assets[0]);
    } catch (e) {
      showAlert('Could not open camera', e.message || 'Try again');
    }
  };

  const selectFlat = (flat) => {
    setFlatNumber(flat.number);
    setFlatQuery(flat.number);
    setShowFlatSuggestions(false);
  };

  const location = isGuard
    ? `${activeMembership?.buildingName} · Gate`
    : [
      activeMembership?.buildingName,
      activeMembership?.flat
    ].filter(Boolean).join(' · ') || 'Your society';

  const canSubmit = name.trim() && (flatNumber.trim() || flatQuery.trim());

  return (
    <View style={styles.container}>
      {isGuard ? (
        <View style={styles.pad}>
          <ScreenHeader
            title="Gate log"
            locationLabel={location}
            locationIcon="shield-outline"
          />
          <PrimaryButton title="+ Log new visitor" onPress={() => { resetForm(); setModalVisible(true); }} variant="accent" />
        </View>
      ) : (
        <ResidentScreenHeader
          navigation={navigation}
          title="Visitors"
          locationLabel={location}
          showBack
        />
      )}

      <FlatList
        data={visitors}
        keyExtractor={(v) => v.id}
        contentContainerStyle={styles.listPad}
        ListHeaderComponent={
          <View>
            {isGuard && sosAlerts.length > 0 && (
              <View style={styles.sosSection}>
                <Text style={styles.sosSectionLabel}>Active SOS</Text>
                {sosAlerts.map((alert) => (
                  <View key={alert.id} style={styles.sosCard}>
                    <View style={styles.sosIcon}>
                      <Ionicons name="warning" size={22} color="#fff" />
                    </View>
                    <View style={styles.sosBody}>
                      <Text style={styles.sosTitle}>SOS alarm</Text>
                      <Text style={styles.sosText}>{alert.body}</Text>
                      <Text style={styles.sosTime}>
                        {new Date(alert.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                    <TouchableOpacity style={styles.sosAck} onPress={() => ackSos(alert.id)}>
                      <Text style={styles.sosAckText}>Ack</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
            <Text style={styles.sectionLabel}>Today</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No visitors logged today.</Text>}
        renderItem={({ item }) => {
          const s = STATUS[item.status] || STATUS.pending;
          return (
            <Card style={styles.row}>
              {item.photoUrl ? (
                <Image source={{ uri: mediaUrl(item.photoUrl) }} style={styles.thumb} />
              ) : null}
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={styles.rowName}>{item.visitorName}</Text>
                <Text style={styles.rowMeta}>
                  {item.purpose}{item.flat?.number ? ` · Flat ${item.flat.number}` : ''}
                </Text>
                {!!item.vehicleNumber && (
                  <Text style={styles.rowMeta}>Vehicle · {item.vehicleNumber}</Text>
                )}
              </View>
              <View style={styles.rowActions}>
                <StatusPill label={s.label} variant={s.variant} />
                {isGuard && item.status === 'inside' && (
                  <TouchableOpacity onPress={() => markExit(item.id)} style={styles.exitBtn}>
                    <Text style={styles.exitText}>Mark exit</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Card>
          );
        }}
      />

      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Log new visitor</Text>
              <Text style={styles.modalHint}>Resident will approve or decline on their home screen.</Text>

              <TextInput
                style={styles.input}
                placeholder="Visitor name"
                value={name}
                onChangeText={setName}
                placeholderTextColor={colors.textMuted}
              />
              <TextInput
                style={styles.input}
                placeholder="Purpose (Delivery/Guest/Service)"
                value={purpose}
                onChangeText={setPurpose}
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.fieldLabel}>Flat</Text>
              <TextInput
                style={styles.input}
                placeholder="Search flat (e.g. A-103)"
                value={flatQuery}
                onChangeText={(v) => {
                  setFlatQuery(v);
                  setFlatNumber('');
                  setShowFlatSuggestions(true);
                }}
                onFocus={() => setShowFlatSuggestions(true)}
                autoCapitalize="characters"
                placeholderTextColor={colors.textMuted}
              />
              {showFlatSuggestions && flatSuggestions.length > 0 && (
                <View style={styles.suggestions}>
                  {flatSuggestions.map((f) => (
                    <TouchableOpacity key={f.id} style={styles.suggestionRow} onPress={() => selectFlat(f)}>
                      <Text style={styles.suggestionText}>{f.number}</Text>
                      <Text style={styles.suggestionWing}>Wing {f.wing}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <TextInput
                style={styles.input}
                placeholder="Vehicle number (optional)"
                value={vehicleNumber}
                onChangeText={setVehicleNumber}
                autoCapitalize="characters"
                placeholderTextColor={colors.textMuted}
              />

              <TouchableOpacity style={styles.photoBtn} onPress={capturePhoto} activeOpacity={0.88}>
                {photo ? (
                  <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
                ) : (
                  <>
                    <Ionicons name="camera-outline" size={28} color={colors.accent} />
                    <Text style={styles.photoText}>
                      {Platform.OS === 'web' ? 'Add visitor photo' : 'Take visitor photo'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              {photo && (
                <TouchableOpacity onPress={() => setPhoto(null)}>
                  <Text style={styles.removePhoto}>Remove photo</Text>
                </TouchableOpacity>
              )}

              {!!error && <Text style={styles.error}>{error}</Text>}
              <PrimaryButton title="Send approval request" onPress={save} loading={loading} disabled={!canSubmit} />
              <TouchableOpacity onPress={() => { setModalVisible(false); resetForm(); }}>
                <Text style={styles.cancel}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  pad: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  listPad: { paddingHorizontal: spacing.lg, paddingBottom: 96 },
  sectionLabel: {
    marginTop: spacing.md, marginBottom: spacing.sm, fontSize: 12, fontWeight: '600',
    color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8
  },
  sosSection: { marginBottom: spacing.sm },
  sosSectionLabel: {
    marginBottom: spacing.sm, fontSize: 12, fontWeight: '700',
    color: '#B71C1C', textTransform: 'uppercase', letterSpacing: 0.8
  },
  sosCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: '#FFEBEE', borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: '#EF9A9A'
  },
  sosIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#C62828',
    alignItems: 'center', justifyContent: 'center'
  },
  sosBody: { flex: 1 },
  sosTitle: { fontSize: 14, fontWeight: '700', color: '#B71C1C' },
  sosText: { fontSize: 13, color: '#5D1A1A', marginTop: 2, lineHeight: 18 },
  sosTime: { fontSize: 11, color: '#8D4A4A', marginTop: 4 },
  sosAck: {
    backgroundColor: '#C62828', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm
  },
  sosAckText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  row: { marginBottom: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  thumb: { width: 44, height: 44, borderRadius: 10, marginRight: spacing.sm, backgroundColor: colors.border },
  rowName: { fontWeight: '600', color: colors.text, fontSize: 15 },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowActions: { alignItems: 'flex-end', gap: 6 },
  exitBtn: { marginTop: 4 },
  exitText: { fontSize: 12, color: colors.accent, fontWeight: '600' },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.lg },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(43,58,74,0.35)',
    justifyContent: 'flex-end',
    alignItems: 'center'
  },
  modalCard: {
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 360 : layout.desktopMaxWidth,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '92%',
    ...(Platform.OS === 'web' ? { borderRadius: radius.lg, margin: spacing.lg } : null)
  },
  modalTitle: { fontSize: 20, fontWeight: '700', marginBottom: 4, color: colors.primary },
  modalHint: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.md, fontSize: 15, backgroundColor: colors.background
  },
  suggestions: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginTop: -8,
    marginBottom: spacing.md, backgroundColor: colors.card, overflow: 'hidden'
  },
  suggestionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border
  },
  suggestionText: { fontSize: 15, fontWeight: '600', color: colors.primary },
  suggestionWing: { fontSize: 12, color: colors.textMuted },
  photoBtn: {
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: radius.md,
    minHeight: 120, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
    backgroundColor: colors.background, overflow: 'hidden'
  },
  photoPreview: { width: '100%', height: 160 },
  photoText: { marginTop: 8, fontSize: 14, fontWeight: '600', color: colors.accent },
  removePhoto: { textAlign: 'center', color: colors.textMuted, marginBottom: spacing.md, fontSize: 13 },
  error: { color: colors.error, marginBottom: spacing.sm },
  cancel: { textAlign: 'center', marginTop: spacing.md, color: colors.textMuted, fontSize: 14, marginBottom: spacing.md }
});
