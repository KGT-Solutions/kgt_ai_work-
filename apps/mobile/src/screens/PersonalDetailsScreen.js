import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius } from '../theme';
import { showAlert } from '../utils/alert';
import PrimaryButton from '../components/PrimaryButton';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

export default function PersonalDetailsScreen({ navigation }) {
  const { user, activeMembership, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [hasPassword, setHasPassword] = useState(!!user?.hasPassword);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const id = 'personal-details-hide-v-scroll';
    if (document.getElementById(id)) return undefined;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '#personal-details-scroll::-webkit-scrollbar,#personal-details-scroll *::-webkit-scrollbar{display:none;width:0;height:0;}';
    document.head.appendChild(style);
    return undefined;
  }, []);

  useFocusEffect(useCallback(() => {
    api.getProfile().then((data) => {
      setName(data.user.name || '');
      setEmail(data.user.email || '');
      setHasPassword(!!data.user.hasPassword);
    }).catch(() => {});
  }, []));

  const save = async () => {
    if (!name.trim()) {
      showAlert('Missing name', 'Please enter your full name.');
      return;
    }

    const payload = {
      name: name.trim(),
      email: email.trim() || null
    };

    if (newPassword || confirmPassword || currentPassword) {
      if (newPassword.length < 6) {
        showAlert('Invalid password', 'New password must be at least 6 characters.');
        return;
      }
      if (newPassword !== confirmPassword) {
        showAlert('Password mismatch', 'New password and confirmation do not match.');
        return;
      }
      if (hasPassword && !currentPassword) {
        showAlert('Current password required', 'Enter your current password to set a new one.');
        return;
      }
      payload.newPassword = newPassword;
      if (hasPassword) payload.currentPassword = currentPassword;
    }

    setLoading(true);
    try {
      const data = await api.updateProfile(payload);
      updateUser(data.user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setHasPassword(!!data.user.hasPassword);
      showAlert('Saved', 'Your personal details were updated.', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (e) {
      showAlert('Could not save', e.message);
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
        nativeID="personal-details-scroll"
        style={Platform.OS === 'web' ? styles.scrollWeb : undefined}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>Basic info</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Full name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            autoCapitalize="words"
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Phone number</Text>
          <TextInput style={[styles.input, styles.readOnly]} value={user?.phone || ''} editable={false} />
          <Text style={styles.hint}>Phone is used for login and cannot be changed here.</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Email (optional)</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        {activeMembership?.flat && (
          <View style={styles.field}>
            <Text style={styles.label}>Flat</Text>
            <TextInput
              style={[styles.input, styles.readOnly]}
              value={`Flat ${activeMembership.flat}`}
              editable={false}
            />
          </View>
        )}

        <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>App password</Text>
        <Text style={styles.hintBlock}>
          {hasPassword
            ? 'Change the password you use to sign in with phone + password.'
            : 'Set a password if you want to sign in without OTP.'}
        </Text>

        {hasPassword && (
          <View style={styles.field}>
            <Text style={styles.label}>Current password</Text>
            <TextInput
              style={styles.input}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Current password"
              secureTextEntry
            />
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>{hasPassword ? 'New password' : 'Password'}</Text>
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="Min 6 characters"
            secureTextEntry
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Confirm password</Text>
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Re-enter password"
            secureTextEntry
          />
        </View>

        <PrimaryButton title="Save changes" onPress={save} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  scrollWeb: { flex: 1, scrollbarWidth: 'none', msOverflowStyle: 'none' },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  sectionLabel: {
    fontSize: 12, fontWeight: '600', color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm
  },
  field: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md, fontSize: 16, backgroundColor: colors.card, color: colors.text
  },
  readOnly: { backgroundColor: colors.background, color: colors.textMuted },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 6, lineHeight: 17 },
  hintBlock: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 19 }
});
