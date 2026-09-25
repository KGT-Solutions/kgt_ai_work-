import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Image,
  KeyboardAvoidingView, Platform
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors, spacing, radius } from '../theme';
import { showAlert } from '../utils/alert';
import PrimaryButton from '../components/PrimaryButton';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = [
  'Login',
  'Home',
  'Bills',
  'Visitors',
  'Complaints',
  'Facilities',
  'Other'
];

export default function ReportBugScreen({ navigation }) {
  const { activeBuildingId, activeMembership } = useAuth();
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [message, setMessage] = useState('');
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Permission needed', 'Allow photo access to attach a screenshot.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8
    });
    if (!result.canceled && result.assets[0]) {
      setImage(result.assets[0]);
    }
  };

  const removeImage = () => setImage(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const id = 'report-bug-hide-v-scroll';
    if (document.getElementById(id)) return undefined;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '#report-bug-scroll::-webkit-scrollbar,#report-bug-scroll *::-webkit-scrollbar{display:none;width:0;height:0;}';
    document.head.appendChild(style);
    return undefined;
  }, []);

  const submit = async () => {
    setError('');
    const trimmed = message.trim();
    if (trimmed.length < 10) {
      setError('Please describe the issue in at least 10 characters.');
      return;
    }
    if (!activeBuildingId) {
      setError('Building not found. Please log out and sign in again.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.createBugReport(
        { category, message: trimmed, source: 'mobile' },
        activeBuildingId,
        image
      );
      showAlert(
        'Bug report sent',
        `Thanks — we’ve received ${res.reference || 'your report'}. We’ll review it.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
      if (Platform.OS === 'web') navigation.goBack();
    } catch (e) {
      setError(e.message || 'Could not send bug report. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        nativeID="report-bug-scroll"
        style={Platform.OS === 'web' ? styles.scrollWeb : undefined}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.hint}>
          For app issues only (crashes, wrong data, login problems). Society complaints
          (noise, parking) belong under Complaints.
        </Text>
        {activeMembership?.buildingName ? (
          <Text style={styles.meta}>
            {activeMembership.buildingName}
            {activeMembership.flat ? ` · Flat ${activeMembership.flat}` : ''}
            {activeMembership.role ? ` · ${activeMembership.role}` : ''}
          </Text>
        ) : null}

        <Text style={styles.label}>Where?</Text>
        <View style={styles.chips}>
          {CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <TouchableOpacity
                key={c}
                onPress={() => setCategory(c)}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.85}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.label}>What went wrong?</Text>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Describe what happened and how to reproduce it…"
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />

        <Text style={styles.label}>Screenshot (optional)</Text>
        {image ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: image.uri }} style={styles.preview} />
            <TouchableOpacity onPress={removeImage} style={styles.removeBtn}>
              <Text style={styles.removeText}>Remove screenshot</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.attachBtn} onPress={pickImage} activeOpacity={0.85}>
            <Text style={styles.attachText}>+ Attach screenshot</Text>
          </TouchableOpacity>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <PrimaryButton title="Send bug report" onPress={submit} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  scrollWeb: { flex: 1, scrollbarWidth: 'none', msOverflowStyle: 'none' },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  hint: { fontSize: 13, color: colors.textMuted, lineHeight: 19, marginBottom: spacing.md },
  meta: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.lg },
  label: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.lg },
  chip: {
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.pill,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, fontSize: 15, backgroundColor: colors.card,
    color: colors.text, minHeight: 120, marginBottom: spacing.lg
  },
  error: { color: colors.error, marginBottom: spacing.md, fontSize: 13 },
  attachBtn: {
    borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: radius.md,
    padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg
  },
  attachText: { color: colors.primary, fontWeight: '600' },
  previewWrap: { marginBottom: spacing.lg },
  preview: { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: colors.border },
  removeBtn: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  removeText: { color: colors.error, fontSize: 13 }
});
