import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { colors, spacing, radius, layout } from '../theme';
import PrimaryButton from '../components/PrimaryButton';
import BrandLogo from '../components/BrandLogo';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { showError, showSuccess } from '../utils/alert';

export default function LoginScreen({ navigation }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('otp');
  const [loading, setLoading] = useState(false);
  const { loginWithPassword } = useAuth();

  const fullPhone = () => `+91${phone.replace(/\D/g, '')}`;

  const submit = async () => {
    setLoading(true);
    try {
      if (mode === 'password') {
        await loginWithPassword(fullPhone(), password);
        await showSuccess('Welcome back to your society.', 'Login successful');
      } else {
        const otpResult = await api.requestOtp(fullPhone(), { purpose: 'login' });
        await showSuccess('Enter the 6-digit code to continue.', 'OTP sent');
        navigation.navigate('Otp', {
          phone: fullPhone(),
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

  const canSubmit = mode === 'password'
    ? phone.replace(/\D/g, '').length === 10 && password.length >= 6
    : phone.replace(/\D/g, '').length === 10;

  return (
    <View style={styles.wrap}>
      <View style={styles.form}>
        <BrandLogo variant="wordmark-color" height={40} style={styles.logo} />
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>OTP is sent to the email on your account</Text>

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

        <Text style={styles.label}>Phone number</Text>
        <View style={styles.inputRow}>
          <Text style={styles.prefix}>+91</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your phone number"
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
              placeholder="Enter your password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            <Text style={styles.passwordHint}>Family members use the password set by the primary resident.</Text>
          </>
        )}

        <PrimaryButton
          title={mode === 'password' ? 'Sign in' : 'Send OTP'}
          onPress={submit}
          loading={loading}
          disabled={!canSubmit}
        />
        <TouchableOpacity onPress={() => navigation.navigate('BuildingCode')} style={styles.linkWrap}>
          <Text style={styles.link}>New member? Signup</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.navigate('GuardLogin')}>
          <Text style={styles.guardLink}>Security guard login</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', padding: spacing.lg, alignItems: 'center' },
  form: { width: '100%', maxWidth: Platform.OS === 'web' ? 360 : layout.desktopMaxWidth },
  logo: { marginBottom: spacing.md, alignSelf: 'flex-start' },
  title: { fontSize: 24, fontWeight: '700', color: colors.primary, letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.md, marginTop: 4 },
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
  linkWrap: { marginTop: spacing.lg },
  link: { color: colors.accent, textAlign: 'center', fontSize: 14, fontWeight: '500' },
  guardLink: { color: colors.primary, textAlign: 'center', fontSize: 13, fontWeight: '600', marginTop: spacing.md }
});
