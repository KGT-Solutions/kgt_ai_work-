import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Modal, FlatList, Pressable, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, layout } from '../theme';
import PrimaryButton from '../components/PrimaryButton';
import BuildingSearchSelect from '../components/BuildingSearchSelect';
import { api } from '../api/client';

function validateSignupForm({ name, phone, email, password, confirmPassword, buildingCode, flatNumber }) {
  const errors = {};
  if (!name.trim()) errors.name = 'Full name is required';
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 10) errors.phone = 'Enter a valid 10-digit phone number';
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) errors.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) errors.email = 'Enter a valid email address';
  if (!password) errors.password = 'Password is required';
  else if (password.length < 6) errors.password = 'Password must be at least 6 characters';
  if (!confirmPassword) errors.confirmPassword = 'Confirm your password';
  else if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';
  if (!buildingCode.trim()) errors.building = 'Select your building';
  if (buildingCode.trim() && !flatNumber.trim()) errors.flat = 'Select a vacant flat';
  return errors;
}

export default function BuildingCodeScreen({ navigation }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [buildings, setBuildings] = useState([]);
  const [buildingCode, setBuildingCode] = useState('');
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [vacantFlats, setVacantFlats] = useState([]);
  const [flatNumber, setFlatNumber] = useState('');
  const [flatPickerOpen, setFlatPickerOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingBuildings, setLoadingBuildings] = useState(true);
  const [loadingFlats, setLoadingFlats] = useState(false);
  const [error, setError] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [devBypass, setDevBypass] = useState(false);

  const fieldErrors = useMemo(
    () => (submitAttempted
      ? validateSignupForm({ name, phone, email, password, confirmPassword, buildingCode, flatNumber })
      : {}),
    [submitAttempted, name, phone, email, password, confirmPassword, buildingCode, flatNumber]
  );

  const loadVacantFlats = async (code) => {
    if (!code) {
      setVacantFlats([]);
      setFlatNumber('');
      return;
    }
    setLoadingFlats(true);
    setFlatNumber('');
    try {
      const data = await api.getVacantFlats(code);
      setVacantFlats(data.flats || []);
    } catch (e) {
      setVacantFlats([]);
      setError(e.message || 'Could not load vacant flats');
    } finally {
      setLoadingFlats(false);
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const id = 'resident-signup-hide-scrollbar';
    if (document.getElementById(id)) return undefined;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '#resident-signup-scroll::-webkit-scrollbar,#resident-signup-scroll *::-webkit-scrollbar{display:none;width:0;height:0;}';
    document.head.appendChild(style);
    return undefined;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [status, list] = await Promise.all([
          api.getAuthStatus().catch(() => ({})),
          api.getBuildings()
        ]);
        if (cancelled) return;
        setDevBypass(!!status.devBypass);
        setBuildings(list);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Could not load buildings');
      } finally {
        if (!cancelled) setLoadingBuildings(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const goBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('Login');
    }
  };

  const chooseBuilding = async (building) => {
    if (!building) {
      setSelectedBuilding(null);
      setBuildingCode('');
      setVacantFlats([]);
      setFlatNumber('');
      return;
    }
    setSelectedBuilding(building);
    setBuildingCode(building.buildingCode);
    setError('');
    await loadVacantFlats(building.buildingCode);
  };

  const chooseFlat = (flat) => {
    setFlatNumber(flat.number);
    setFlatPickerOpen(false);
    setError('');
  };

  const validationSummary = submitAttempted && Object.keys(fieldErrors).length > 0
    ? 'Please fix the highlighted fields below.'
    : '';

  const submit = async () => {
    setSubmitAttempted(true);
    setError('');
    const validation = validateSignupForm({ name, phone, email, password, confirmPassword, buildingCode, flatNumber });
    if (Object.keys(validation).length > 0) return;

    setLoading(true);
    try {
      const fullPhone = `+91${phone.replace(/\D/g, '')}`;
      const trimmedEmail = email.trim().toLowerCase();
      const signupData = {
        name: name.trim(),
        email: trimmedEmail,
        buildingCode: buildingCode.trim().toUpperCase(),
        flatNumber: flatNumber.trim().toUpperCase(),
        password
      };
      await api.validateSignup({ buildingCode: signupData.buildingCode, flatNumber: signupData.flatNumber });
      const otpResult = await api.requestOtp(fullPhone, { email: trimmedEmail, purpose: 'signup' });
      navigation.navigate('Otp', {
        phone: fullPhone,
        signupData,
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

  const selectedFlat = vacantFlats.find((f) => f.number === flatNumber);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
        <Ionicons name="arrow-back" size={22} color={colors.primary} />
        <Text style={styles.backLabel}>Back</Text>
      </TouchableOpacity>
      <ScrollView
        nativeID="resident-signup-scroll"
        style={styles.form}
        contentContainerStyle={styles.formContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        <Text style={styles.title}>Join your building</Text>
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

        <FieldLabel text="Password" error={fieldErrors.password} />
        <TextInput
          style={[styles.input, fieldErrors.password && styles.inputError]}
          placeholder="Password (min 6 characters)"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={password}
          onChangeText={setPassword}
        />
        <FieldError message={fieldErrors.password} />

        <FieldLabel text="Confirm password" error={fieldErrors.confirmPassword} />
        <TextInput
          style={[styles.input, fieldErrors.confirmPassword && styles.inputError]}
          placeholder="Confirm password"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />
        <FieldError message={fieldErrors.confirmPassword} />
        <Text style={styles.passwordHint}>After approval, use this password with your phone number to sign in.</Text>

        <BuildingSearchSelect
          buildings={buildings}
          selected={selectedBuilding}
          onSelect={chooseBuilding}
          loading={loadingBuildings}
          label="Building"
          placeholder="Search building name or code…"
          error={fieldErrors.building}
        />

        <FieldLabel text="Vacant flat" error={fieldErrors.flat} />
        <TouchableOpacity
          style={[styles.select, (fieldErrors.flat || fieldErrors.building) && styles.inputError]}
          onPress={() => setFlatPickerOpen(true)}
          disabled={!buildingCode || loadingFlats || vacantFlats.length === 0}
        >
          <View style={{ flex: 1 }}>
            {selectedFlat ? (
              <>
                <Text style={styles.selectTitle}>{selectedFlat.number}</Text>
                <Text style={styles.selectCode}>{selectedFlat.wing}</Text>
              </>
            ) : (
              <Text style={styles.selectPlaceholder}>
                {!buildingCode
                  ? 'Select a building first'
                  : loadingFlats
                    ? 'Loading vacant flats…'
                    : vacantFlats.length === 0
                      ? 'No vacant flats available'
                      : 'Select vacant flat'}
              </Text>
            )}
          </View>
          <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
        </TouchableOpacity>
        <FieldError message={fieldErrors.flat || fieldErrors.building} />
        {buildingCode && !loadingFlats && vacantFlats.length > 0 && (
          <Text style={styles.formatHint}>{vacantFlats.length} vacant flat{vacantFlats.length === 1 ? '' : 's'} available</Text>
        )}

        {!!validationSummary && <Text style={styles.validationSummary}>{validationSummary}</Text>}
        {!!error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton
          title="Send OTP & continue"
          onPress={submit}
          loading={loading}
        />
        <Text style={styles.footNote}>
          We will email a verification code, then submit your join request for admin approval.
        </Text>
      </ScrollView>

      <PickerModal
        visible={flatPickerOpen}
        title="Select vacant flat"
        onClose={() => setFlatPickerOpen(false)}
        data={vacantFlats}
        keyExtractor={(item) => item.id}
        activeKey={flatNumber}
        getActiveKey={(item) => item.number}
        onSelect={chooseFlat}
        renderPrimary={(item) => item.number}
        renderSecondary={(item) => item.wing}
      />
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

function PickerModal({
  visible, title, onClose, data, keyExtractor, activeKey, getActiveKey, onSelect, renderPrimary, renderSecondary
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation?.()}>
          <Text style={styles.modalTitle}>{title}</Text>
          <FlatList
            data={data}
            keyExtractor={keyExtractor}
            renderItem={({ item }) => {
              const active = getActiveKey(item) === activeKey;
              return (
                <TouchableOpacity
                  style={[styles.option, active && styles.optionActive]}
                  onPress={() => onSelect(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.optionName}>{renderPrimary(item)}</Text>
                    <Text style={styles.optionMeta}>{renderSecondary(item)}</Text>
                  </View>
                  {active && <Ionicons name="checkmark" size={18} color={colors.accent} />}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={styles.emptyList}>Nothing to show</Text>}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', padding: spacing.lg },
  backBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  backLabel: { marginLeft: 4, fontSize: 16, fontWeight: '500', color: colors.primary },
  form: {
    flex: 1,
    ...(Platform.OS === 'web'
      ? { scrollbarWidth: 'none', msOverflowStyle: 'none' }
      : null)
  },
  formContent: { flexGrow: 1, justifyContent: 'center', paddingBottom: spacing.xl },
  title: { fontSize: 28, fontWeight: '700', color: colors.primary, marginBottom: spacing.lg },
  passwordHint: { fontSize: 12, color: colors.textMuted, marginTop: -8, marginBottom: spacing.md, lineHeight: 18 },
  fieldLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: '600' },
  fieldLabelError: { color: colors.error },
  fieldError: { color: colors.error, fontSize: 12, marginTop: 4, marginBottom: spacing.sm, lineHeight: 16 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md, fontSize: 16 },
  inputError: { borderColor: colors.error },
  select: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md,
    marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff'
  },
  selectTitle: { fontSize: 16, fontWeight: '600', color: colors.primary },
  selectCode: { fontSize: 12, color: colors.textMuted, marginTop: 2, letterSpacing: 0.4 },
  selectPlaceholder: { fontSize: 16, color: colors.textMuted },
  error: { color: colors.error, marginBottom: spacing.md, textAlign: 'center' },
  validationSummary: { color: colors.error, marginBottom: spacing.md, textAlign: 'center', fontSize: 13, fontWeight: '600' },
  formatHint: { color: colors.textMuted, fontSize: 11, marginTop: -8, marginBottom: spacing.md },
  otpHint: { fontSize: 14, fontWeight: '600', color: colors.primary, marginBottom: spacing.md, textAlign: 'center' },
  footNote: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md, textAlign: 'center' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 35, 26, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg
  },
  modalCard: {
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 360 : layout.desktopMaxWidth,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    maxHeight: '70%',
    paddingVertical: 12
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.primary, paddingHorizontal: 16, paddingBottom: 8 },
  option: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border
  },
  optionActive: { backgroundColor: '#F3F7F4' },
  optionName: { fontSize: 15, fontWeight: '600', color: colors.primary },
  optionMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2, letterSpacing: 0.3 },
  emptyList: { padding: 16, color: colors.textMuted, textAlign: 'center' }
});
