import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { colors, spacing, radius } from '../theme';
import PrimaryButton from '../components/PrimaryButton';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { showAlert, showError, showSuccess } from '../utils/alert';

async function showSignupSuccessThenGoLogin(navigation, target = 'Login') {
  await showAlert(
    'Request submitted',
    'Your signup request was submitted successfully. Waiting for admin approval.',
    [{ text: 'OK', onPress: () => navigation.navigate(target) }]
  );
}

export default function OtpScreen({ route, navigation }) {
  const {
    phone,
    signupData,
    guardSignupData,
    guardLogin,
    email: signupEmail,
    emailHint: initialEmailHint,
    channel: initialChannel
  } = route.params || {};
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailHint, setEmailHint] = useState(initialEmailHint || null);
  const [channel, setChannel] = useState(initialChannel || null);
  const { login } = useAuth();

  const verify = async () => {
    setLoading(true);
    try {
      if (guardSignupData) {
        await api.guardSignup({ ...guardSignupData, phone, otp });
        await showSignupSuccessThenGoLogin(navigation, 'GuardLogin');
      } else if (signupData) {
        await api.signup({ ...signupData, phone, otp });
        await showSignupSuccessThenGoLogin(navigation);
      } else if (guardLogin?.buildingId) {
        await login(phone, otp, guardLogin.buildingId, { requireRole: 'guard' });
        await showSuccess('You are signed in as a security guard.', 'Login successful');
      } else {
        await login(phone, otp);
        await showSuccess('Welcome back to your society.', 'Login successful');
      }
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setLoading(true);
    try {
      const isSignup = !!(signupData || guardSignupData);
      const result = await api.requestOtp(phone, {
        email: signupEmail || signupData?.email || guardSignupData?.email,
        purpose: isSignup ? 'signup' : 'login'
      });
      setEmailHint(result.emailHint || null);
      setChannel(result.channel || null);
      setOtp('');
      showSuccess('A new code has been sent.', 'OTP resent');
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const destination =
    channel === 'email' || emailHint
      ? emailHint || 'your email'
      : phone;

  const hintText =
    channel === 'email' || emailHint
      ? 'Check your email inbox for the verification code.'
      : channel === 'sms'
        ? 'Check SMS for your verification code.'
        : 'Check WhatsApp, SMS, or email for your verification code.';

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enter the code</Text>
      <Text style={styles.subtitle}>Sent to {destination}</Text>
      <TextInput
        style={styles.input}
        placeholder="6-digit code"
        keyboardType="number-pad"
        maxLength={6}
        value={otp}
        onChangeText={setOtp}
      />
      {/* <Text style={styles.otpHint}>try otp : 123456</Text> */}
      <PrimaryButton
        title={signupData || guardSignupData ? 'Verify & submit request' : 'Verify'}
        onPress={verify}
        loading={loading}
        disabled={otp.length !== 6}
      />
      <TouchableOpacity onPress={resend} disabled={loading}>
        <Text style={styles.link}>Resend OTP</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>{hintText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent', padding: spacing.lg, justifyContent: 'center' },
  title: { fontSize: 28, fontWeight: '700', color: colors.primary },
  subtitle: { color: colors.textMuted, marginBottom: spacing.lg },
  input: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 10,
    letterSpacing: 8,
    textAlign: 'center',
    marginBottom: spacing.sm,
    backgroundColor: colors.card,
    // Kill browser default orange focus ring on web
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : null)
  },
  otpHint: {
    textAlign: 'center',
    color: colors.primary,
    marginBottom: spacing.md,
    fontSize: 14,
    fontWeight: '600'
  },
  hint: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.md, fontSize: 12 },
  link: { textAlign: 'center', color: colors.accent, marginTop: spacing.md, fontSize: 14 }
});
