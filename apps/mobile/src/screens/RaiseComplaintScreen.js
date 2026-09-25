import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, Image, ScrollView, KeyboardAvoidingView, Platform
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors, spacing, radius } from '../theme';
import PrimaryButton from '../components/PrimaryButton';
import PageHeader from '../components/PageHeader';
import { showAlert } from '../utils/alert';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const CATEGORIES = ['Plumbing', 'Electrical', 'Housekeeping', 'Security', 'Parking', 'Other'];

export default function RaiseComplaintScreen({ navigation }) {
  const { activeBuildingId, activeMembership } = useAuth();
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Permission needed', 'Allow photo access to attach an image.');
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

  const submit = async () => {
    setError('');
    if (!description.trim()) {
      setError('Please describe the issue before submitting.');
      return;
    }
    if (!activeBuildingId) {
      setError('Building not found. Please log out and sign in again.');
      return;
    }
    if (activeMembership?.role !== 'resident') {
      setError('Only residents can raise complaints. Sign in with a resident account.');
      return;
    }

    setLoading(true);
    try {
      await api.raiseComplaint(
        { category, title: description.trim().slice(0, 40) || category, description: description.trim() },
        activeBuildingId,
        image
      );
      showAlert('Complaint submitted', 'Your complaint has been sent to the building admin.', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
      if (Platform.OS === 'web') {
        navigation.goBack();
      }
    } catch (e) {
      setError(e.message || 'Could not submit complaint. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <PageHeader navigation={navigation} title="Raise a complaint" />
        <View style={styles.body}>
          <Text style={styles.sectionTitle}>What's the issue?</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity key={c} onPress={() => setCategory(c)} style={[styles.chip, category === c && styles.chipActive]}>
                <Text style={category === c ? styles.chipTextActive : styles.chipText}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.textArea}
            placeholder="Describe the issue"
            multiline
            numberOfLines={4}
            value={description}
            onChangeText={setDescription}
          />

          <Text style={styles.optionalLabel}>Photo (optional)</Text>
          {image ? (
            <View style={styles.previewWrap}>
              <Image source={{ uri: image.uri }} style={styles.preview} />
              <TouchableOpacity onPress={removeImage} style={styles.removeBtn}>
                <Text style={styles.removeText}>Remove photo</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.attachBtn} onPress={pickImage}>
              <Text style={styles.attachText}>+ Attach photo</Text>
            </TouchableOpacity>
          )}

          {!!error && <Text style={styles.error}>{error}</Text>}
          <PrimaryButton title="Submit complaint" onPress={submit} loading={loading} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingBottom: spacing.xl },
  body: { paddingHorizontal: spacing.lg },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, marginBottom: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8, marginBottom: 8 },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  textArea: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, minHeight: 120, textAlignVertical: 'top', marginBottom: spacing.md, backgroundColor: colors.card },
  optionalLabel: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm },
  attachBtn: { borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', borderRadius: radius.md, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.md },
  attachText: { color: colors.primary, fontWeight: '600' },
  previewWrap: { marginBottom: spacing.md },
  preview: { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: '#E9EBEA' },
  removeBtn: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  removeText: { color: colors.error, fontSize: 13 },
  error: { color: colors.error, marginBottom: spacing.md, fontSize: 14, lineHeight: 20 }
});
