import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { colors, spacing, radius } from '../theme';
import PrimaryButton from '../components/PrimaryButton';
import BrandLogo from '../components/BrandLogo';
import BuildingSearchSelect from '../components/BuildingSearchSelect';
import { GUARD_DEFAULT_PASSWORD } from '../constants/auth';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { showError, showSuccess } from '../utils/alert';

export default function GuardLoginScreen({ navigation }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState(GUARD_DEFAULT_PASSWORD);
  const [mode, setMode] = useState('otp');
  const [buildings, setBuildings] = useState([]);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [loadingBuildings, setLoadingBuildings] = useState(true);
  const [loading, setLoading] = useState(false);
  const { loginWithPassword } = useAuth();

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const id = 'guard-login-hide-scrollbar';
    if (document.getElementById(id)) return undefined;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '#guard-login-scroll::-webkit-scrollbar,#guard-login-scroll *::-webkit-scrollbar{display:none;width:0;height:0;}';
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
        if (!cancelled) showError(e.message || 'Could not load buildings');
      } finally {
        if (!cancelled) setLoadingBuildings(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fullPhone = () => `+91${phone.replace(/\D/g, '')}`;

  const submit = async () => {
    if (!selectedBuilding) {
      showError('Please select a building.');
      return;
    }
    setLoading(true);
    try {
      if (mode === 'password') {
        await loginWithPassword(fullPhone(), password, selectedBuilding.id, { requireRole: 'guard' });
        await showSuccess('You are signed in as a security guard.', 'Login successful');
      } else {
        const otpResult = await api.requestOtp(fullPhone(), { purpose: 'login' });
        await showSuccess('Enter the 6-digit code to continue.', 'OTP sent');
        navigation.navigate('Otp', {
          phone: fullPhone(),
          guardLogin: { buildingId: selectedBuilding.id },
          emailHint: otpResult.emailHint,
          channel: otpResult.channel
        });
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = phone.replace(/\D/g, '').length === 10
    && !!selectedBuilding
    && (mode === 'otp' || password.length >= 6);

  return (
    <ScrollView
      nativeID="guard-login-scroll"
      style={[styles.wrap, Platform.OS === 'web' && styles.wrapWeb]}
      contentContainerStyle={styles.wrapContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
    >
      <View style={styles.form}>
        <BrandLogo variant="wordmark-color" height={32} style={styles.logo} />
        <Text style={styles.title}>Guard login</Text>
        <Text style={styles.subtitle}>Manage visitors and gate access</Text>

        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeChip, mode === 'otp' && styles.modeChipActive]}
            onPress={() => setMode('otp')}
          >
            <Text style={[styles.modeText, mode === 'otp' && styles.modeTextActive]}>OTP login</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeChip, mode === 'password' && styles.modeChipActive]}
            onPress={() => setMode('password')}
          >
            <Text style={[styles.modeText, mode === 'password' && styles.modeTextActive]}>Password</Text>
          </TouchableOpacity>
        </View>

        <BuildingSearchSelect
          buildings={buildings}
          selected={selectedBuilding}
          onSelect={setSelectedBuilding}
          loading={loadingBuildings}
          label="Building"
          placeholder="Search building name or code…"
        />

        <Text style={styles.label}>Phone number</Text>
        <View style={styles.inputRow}>
          <Text style={styles.prefix}>+91</Text>
          <TextInput
            style={styles.input}
            placeholder="Guard phone number"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            value={phone}
            onChangeText={setPhone}
            maxLength={10}
          />
        </View>

        {mode === 'password' && (
          <>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.passwordInput}
              placeholder="Guard password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Text style={styles.passwordHint}>Default guard password is {GUARD_DEFAULT_PASSWORD}</Text>
          </>
        )}

        <PrimaryButton
          title={mode === 'password' ? 'Sign in' : 'Send OTP'}
          onPress={submit}
          loading={loading}
          disabled={!canSubmit}
        />

        <TouchableOpacity onPress={() => navigation.navigate('GuardSignup')} style={styles.signupLink}>
          <Text style={styles.link}>New guard? Sign up</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('Login')}>
          <Text style={styles.linkMuted}>← Back to resident login</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'transparent' },
  wrapWeb: { scrollbarWidth: 'none', msOverflowStyle: 'none' },
  wrapContent: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  form: { width: '100%' },
  logo: { marginBottom: spacing.md, alignSelf: 'flex-start' },
  title: { fontSize: 24, fontWeight: '700', color: colors.primary, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg, marginTop: 4 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: spacing.md, width: '100%' },
  modeChip: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  modeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  modeTextActive: { color: '#fff' },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.xs, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  prefix: { fontSize: 16, color: colors.text, marginRight: spacing.sm, fontWeight: '500' },
  input: { flex: 1, paddingVertical: spacing.md, fontSize: 16, color: colors.text },
  passwordInput: { backgroundColor: colors.card, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, fontSize: 16, color: colors.text },
  passwordHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
  signupLink: { marginTop: spacing.lg },
  link: { color: colors.accent, textAlign: 'center', fontSize: 14, fontWeight: '500' },
  linkMuted: { color: colors.primary, textAlign: 'center', fontSize: 13, fontWeight: '600', marginTop: spacing.md }
});
