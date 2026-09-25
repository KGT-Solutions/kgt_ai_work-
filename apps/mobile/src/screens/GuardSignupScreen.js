import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import PrimaryButton from '../components/PrimaryButton';
import BuildingSearchSelect from '../components/BuildingSearchSelect';
import GuardBrandHeader from '../components/GuardBrandHeader';
import { api } from '../api/client';

function validateGuardSignupForm({ name, phone, email, buildingCode }) {
  const errors = {};
  if (!name.trim()) errors.name = 'Full name is required';
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 10) errors.phone = 'Enter a valid 10-digit phone number';
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) errors.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) errors.email = 'Enter a valid email address';
  if (!buildingCode.trim()) errors.building = 'Select your building';
  return errors;
}

export default function GuardSignupScreen({ navigation }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingBuildings, setLoadingBuildings] = useState(true);
  const [error, setError] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const buildingCode = selectedBuilding?.buildingCode || '';

  const fieldErrors = useMemo(
    () => (submitAttempted
      ? validateGuardSignupForm({ name, phone, email, buildingCode })
      : {}),
    [submitAttempted, name, phone, email, buildingCode]
  );

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const id = 'guard-signup-hide-scrollbar';
    if (document.getElementById(id)) return undefined;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '#guard-signup-scroll::-webkit-scrollbar,#guard-signup-scroll *::-webkit-scrollbar{display:none;width:0;height:0;}';
    document.head.appendChild(style);
    return undefined;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.getBuildings();
        if (!cancelled) setBuildings(list);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load buildings');
      } finally {
        if (!cancelled) setLoadingBuildings(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const chooseBuilding = (building) => {
    setSelectedBuilding(building);
    setError('');
  };

  const submit = async () => {
    setSubmitAttempted(true);
    setError('');
    const validation = validateGuardSignupForm({ name, phone, email, buildingCode });
    if (Object.keys(validation).length > 0) return;

    setLoading(true);
    try {
      const fullPhone = `+91${phone.replace(/\D/g, '')}`;
      const trimmedEmail = email.trim().toLowerCase();
      const guardSignupData = {
        name: name.trim(),
        email: trimmedEmail,
        buildingCode: selectedBuilding.buildingCode
      };
      await api.validateGuardSignup({ buildingCode: guardSignupData.buildingCode });
      const otpResult = await api.requestOtp(fullPhone, { email: trimmedEmail, purpose: 'signup' });
      navigation.navigate('Otp', {
        phone: fullPhone,
        guardSignupData,
        email: trimmedEmail,
        emailHint: otpResult.emailHint,
        channel: otpResult.channel
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const validationSummary = submitAttempted && Object.keys(fieldErrors).length > 0
    ? 'Please fix the highlighted fields below.'
    : '';

  return (
    <View style={styles.root}>
      <GuardBrandHeader />
      <ScrollView
        nativeID="guard-signup-scroll"
        style={[styles.container, Platform.OS === 'web' && styles.containerWeb]}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={12}>
        <Ionicons name="arrow-back" size={22} color={colors.primary} />
        <Text style={styles.backLabel}>Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Join as security guard</Text>
      <Text style={styles.subtitle}>Select your society, verify your phone, and wait for admin approval.</Text>

      <FieldLabel text="Full name" error={fieldErrors.name} />
      <TextInput
        style={[styles.input, fieldErrors.name && styles.inputError]}
        placeholder="Full name"
        value={name}
        onChangeText={setName}
      />
      <FieldError message={fieldErrors.name} />

      <FieldLabel text="Phone number" error={fieldErrors.phone} />
      <TextInput
        style={[styles.input, fieldErrors.phone && styles.inputError]}
        placeholder="Phone number"
        keyboardType="number-pad"
        value={phone}
        onChangeText={setPhone}
        maxLength={10}
      />
      <FieldError message={fieldErrors.phone} />

      <FieldLabel text="Email address" error={fieldErrors.email} />
      <TextInput
        style={[styles.input, fieldErrors.email && styles.inputError]}
        placeholder="Email address"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        value={email}
        onChangeText={setEmail}
      />
      <FieldError message={fieldErrors.email} />

      <BuildingSearchSelect
        buildings={buildings}
        selected={selectedBuilding}
        onSelect={chooseBuilding}
        loading={loadingBuildings}
        label="Building"
        placeholder="Search building name or code…"
        error={fieldErrors.building}
      />

      {!!validationSummary && <Text style={styles.validationSummary}>{validationSummary}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
      <PrimaryButton
        title="Send OTP & continue"
        onPress={submit}
        loading={loading}
      />
      <Text style={styles.footNote}>
        We will email a verification code, then submit your guard request for admin approval.
      </Text>
    </ScrollView>
    </View>
  );
}

function FieldLabel({ text, error }) {
  return (
    <Text style={[styles.fieldLabel, error && styles.fieldLabelError]}>{text}</Text>
  );
}

function FieldError({ message }) {
  if (!message) return null;
  return <Text style={styles.fieldError}>{message}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  container: { flex: 1, backgroundColor: 'transparent' },
  containerWeb: { scrollbarWidth: 'none', msOverflowStyle: 'none' },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  backLabel: { marginLeft: 4, fontSize: 16, fontWeight: '500', color: colors.primary },
  title: { fontSize: 28, fontWeight: '700', color: colors.primary, marginBottom: spacing.sm },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 20 },
  fieldLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: '600' },
  fieldLabelError: { color: colors.error },
  fieldError: { color: colors.error, fontSize: 12, marginTop: 4, marginBottom: spacing.sm, lineHeight: 16 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: 16, backgroundColor: colors.card },
  inputError: { borderColor: colors.error },
  validationSummary: { color: colors.error, marginBottom: spacing.md, textAlign: 'center', fontSize: 13, fontWeight: '600' },
  error: { color: colors.error, marginBottom: spacing.md, textAlign: 'center' },
  footNote: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md, textAlign: 'center', lineHeight: 18 }
});
