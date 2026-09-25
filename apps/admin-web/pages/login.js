import { useState } from 'react';
import { useRouter } from 'next/router';
import { api } from '../lib/api';
import { filterAdminMemberships } from '../lib/memberships';
import { showError, showSuccess } from '../components/AppAlert';

function normalizePhoneInput(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (phone.trim().startsWith('+')) return phone.trim();
  return phone.trim();
}

export default function Login() {
  const [loginType, setLoginType] = useState('building');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('phone');
  const [emailHint, setEmailHint] = useState(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const finishLogin = async (data, preferredBuildingCode) => {
    window.localStorage.setItem('token', data.token);
    window.localStorage.setItem('user', JSON.stringify(data.user));

    if (data.user.isSuperAdmin && loginType === 'super') {
      window.localStorage.setItem('memberships', JSON.stringify([]));
      await showSuccess('You are signed in as super admin.', 'Login successful');
      router.push('/buildings');
      return;
    }

    const memberships = filterAdminMemberships(data.memberships);
    window.localStorage.setItem('memberships', JSON.stringify(memberships));

    const preferred = preferredBuildingCode
      ? memberships.find((m) => m.buildingCode === preferredBuildingCode)
      : null;
    if (preferred?.buildingId) {
      await showSuccess('Welcome back. Redirecting to your society dashboard.', 'Login successful');
      router.push(`/dashboard/${preferred.buildingId}`);
      return;
    }

    if (memberships.length > 1) {
      await showSuccess('Choose a society to continue.', 'Login successful');
      router.push('/select-society');
      return;
    }

    const membership = memberships.find((m) => m.role === 'building_admin')
      || memberships.find((m) => m.role === 'committee_member')
      || null;

    if (membership?.buildingId) {
      await showSuccess('Welcome back. Redirecting to your society dashboard.', 'Login successful');
      router.push(`/dashboard/${membership.buildingId}`);
    } else {
      showError('No building admin access for this number.');
    }
  };

  const resetForm = () => {
    setStep('phone');
    setOtp('');
    setPassword('');
    setEmailHint(null);
  };

  const switchLoginType = (type) => {
    setLoginType(type);
    resetForm();
  };

  const sendOtp = async () => {
    setLoading(true);
    try {
      const normalized = normalizePhoneInput(phone);
      const result = await api.requestOtp(normalized, { purpose: 'login' });
      setPhone(normalized);
      setEmailHint(result.emailHint || null);
      setStep('otp');
      await showSuccess(
        result.emailHint
          ? `OTP sent to ${result.emailHint}`
          : `OTP sent to ${normalized}`,
        'OTP sent'
      );
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const verify = async () => {
    setLoading(true);
    try {
      await finishLogin(await api.verifyOtp(phone, otp, { surface: 'admin' }));
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const superAdminLogin = async () => {
    setLoading(true);
    try {
      const normalized = normalizePhoneInput(phone);
      await finishLogin(await api.loginPassword(normalized, password, { surface: 'admin' }));
    } catch (e) {
      showError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const localDigits = phone.replace(/\D/g, '').replace(/^91/, '');
  const canSendOtp = localDigits.length === 10 || phone.replace(/\D/g, '').length === 10;
  const canSuperLogin = canSendOtp && password.length >= 6;
  const otpDestination = emailHint || phone;

  return (
    <div className="admin-login-wrap">
      <div className="admin-login-atmosphere" aria-hidden="true" />

      <div className="admin-login-card">
        <div className="admin-login-brand">
          <img
            src="/brand/wordmark-color.png"
            alt="FLATBRIZ"
            className="admin-login-wordmark"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              const fallback = e.currentTarget.nextElementSibling;
              if (fallback) fallback.hidden = false;
            }}
          />
          <h1 className="admin-login-brand-name" hidden>FLATBRIZ</h1>
          <p className="admin-login-tagline">Admin console for your building</p>
        </div>

        <div className="admin-login-segment" role="tablist" aria-label="Login type">
          <button
            type="button"
            role="tab"
            aria-selected={loginType === 'building'}
            className={`admin-login-segment-btn${loginType === 'building' ? ' is-active' : ''}`}
            onClick={() => switchLoginType('building')}
          >
            Building admin
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={loginType === 'super'}
            className={`admin-login-segment-btn${loginType === 'super' ? ' is-active' : ''}`}
            onClick={() => switchLoginType('super')}
          >
            Super admin
          </button>
        </div>

        {loginType === 'building' ? (
          step === 'phone' ? (
            <form
              className="admin-login-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSendOtp && !loading) sendOtp();
              }}
            >
              <label className="admin-login-label" htmlFor="admin-phone">
                Phone number
              </label>
              <div className="admin-login-prefix-field">
                <span className="admin-login-prefix">+91</span>
                <input
                  id="admin-phone"
                  className="admin-login-input admin-login-input--bare"
                  placeholder="10-digit mobile"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <p className="admin-login-helper">OTP is sent to the email on your account</p>
              <button
                type="submit"
                className="admin-login-cta"
                disabled={loading || !canSendOtp}
              >
                {loading ? 'Sending…' : 'Send OTP'}
              </button>
            </form>
          ) : (
            <form
              className="admin-login-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (otp.length === 6 && !loading) verify();
              }}
            >
              <p className="admin-login-sent">
                Code sent to <strong>{otpDestination}</strong>
              </p>
              <label className="admin-login-label" htmlFor="admin-otp">
                Verification code
              </label>
              <input
                id="admin-otp"
                className="admin-login-input admin-login-input--otp"
                placeholder="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
              />
              <button
                type="submit"
                className="admin-login-cta"
                disabled={loading || otp.length !== 6}
              >
                {loading ? 'Verifying…' : 'Verify & continue'}
              </button>
              <button type="button" className="admin-login-link" onClick={resetForm}>
                Change number
              </button>
            </form>
          )
        ) : (
          <form
            className="admin-login-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSuperLogin && !loading) superAdminLogin();
            }}
          >
            <label className="admin-login-label" htmlFor="super-phone">
              Phone number
            </label>
            <div className="admin-login-prefix-field">
              <span className="admin-login-prefix">+91</span>
              <input
                id="super-phone"
                className="admin-login-input admin-login-input--bare"
                placeholder="10-digit mobile"
                inputMode="numeric"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <label className="admin-login-label" htmlFor="super-password">
              Password
            </label>
            <input
              id="super-password"
              className="admin-login-input"
              type="password"
              placeholder="Enter password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button
              type="submit"
              className="admin-login-cta"
              disabled={loading || !canSuperLogin}
            >
              {loading ? 'Signing in…' : 'Sign in as super admin'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
