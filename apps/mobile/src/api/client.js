import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:4000';

export function mediaUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${BASE_URL}${path}`;
}

async function request(path, { method = 'GET', body, buildingId } = {}) {
  const token = await AsyncStorage.getItem('token');
  const sessionRaw = await AsyncStorage.getItem('session');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (buildingId) headers['X-Building-Id'] = buildingId;
  if (sessionRaw) {
    try {
      const session = JSON.parse(sessionRaw);
      if (session.activeMembershipId) headers['X-Membership-Id'] = session.activeMembershipId;
    } catch {
      /* ignore bad session */
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function requestMultipart(path, { method = 'POST', formData, buildingId } = {}) {
  const token = await AsyncStorage.getItem('token');
  const sessionRaw = await AsyncStorage.getItem('session');
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (buildingId) headers['X-Building-Id'] = buildingId;
  if (sessionRaw) {
    try {
      const session = JSON.parse(sessionRaw);
      if (session.activeMembershipId) headers['X-Membership-Id'] = session.activeMembershipId;
    } catch {
      /* ignore bad session */
    }
  }

  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function appendImage(formData, image) {
  const name = image.fileName || `photo-${Date.now()}.jpg`;
  const type = image.mimeType || 'image/jpeg';
  if (Platform.OS === 'web') {
    const blob = await fetch(image.uri).then((r) => r.blob());
    formData.append('image', blob, name);
  } else {
    formData.append('image', { uri: image.uri, name, type });
  }
}

export const api = {
  getAuthStatus: () => request('/auth/status'),
  getBuildings: () => request('/auth/buildings'),
  getVacantFlats: (buildingCode) =>
    request(`/auth/buildings/${encodeURIComponent(buildingCode)}/vacant-flats`),
  getProfile: () => request('/auth/me'),
  updateProfile: (payload) => request('/auth/profile', { method: 'PATCH', body: payload }),
  requestOtp: (phone, { email, purpose } = {}) =>
    request('/auth/request-otp', {
      method: 'POST',
      body: {
        phone,
        ...(email ? { email } : {}),
        ...(purpose ? { purpose } : {})
      }
    }),
  verifyOtp: (phone, otp, { surface } = {}) =>
    request('/auth/verify-otp', { method: 'POST', body: { phone, otp, ...(surface ? { surface } : {}) } }),
  devLogin: (phone, { surface } = {}) =>
    request('/auth/dev-login', { method: 'POST', body: { phone, ...(surface ? { surface } : {}) } }),
  loginWithPassword: (phone, password, { surface } = {}) =>
    request('/auth/login-password', {
      method: 'POST',
      body: { phone, password, ...(surface ? { surface } : {}) }
    }),
  validateSignup: (payload) => request('/auth/validate-signup', { method: 'POST', body: payload }),
  validateGuardSignup: (payload) => request('/auth/validate-guard-signup', { method: 'POST', body: payload }),
  signup: (payload) => request('/auth/signup', { method: 'POST', body: payload }),
  guardSignup: (payload) => request('/auth/guard-signup', { method: 'POST', body: payload }),
  getBills: async (buildingId) => {
    const data = await request('/bills', { buildingId });
    if (Array.isArray(data)) return { bills: data, account: null, qrImageUrl: null };
    return {
      bills: data.bills || [],
      account: data.account || null,
      qrImageUrl: data.qrImageUrl || null
    };
  },
  getPaymentQr: (buildingId) => request('/finance/payment-qr', { buildingId }),
  payBill: async (billId, buildingId, image) => {
    if (!image) {
      throw new Error('Payment screenshot is required to confirm payment');
    }
    const formData = new FormData();
    await appendImage(formData, image);
    return requestMultipart(`/bills/${billId}/pay`, { method: 'POST', formData, buildingId });
  },
  getComplaints: (buildingId) => request('/complaints', { buildingId }),
  raiseComplaint: async (payload, buildingId, image) => {
    if (!image) {
      return request('/complaints', { method: 'POST', body: payload, buildingId });
    }
    const formData = new FormData();
    formData.append('category', payload.category);
    formData.append('title', payload.title);
    formData.append('description', payload.description || '');
    await appendImage(formData, image);
    return requestMultipart('/complaints', { method: 'POST', formData, buildingId });
  },
  getVisitors: (buildingId) => request('/visitors', { buildingId }),
  getVisitorFlats: (buildingId) => request('/visitors/flats', { buildingId }),
  logVisitor: async (payload, buildingId, image) => {
    if (!image) {
      return request('/visitors', { method: 'POST', body: payload, buildingId });
    }
    const formData = new FormData();
    formData.append('visitorName', payload.visitorName);
    formData.append('purpose', payload.purpose || 'Guest');
    formData.append('flatNumber', payload.flatNumber);
    if (payload.vehicleNumber) formData.append('vehicleNumber', payload.vehicleNumber);
    await appendImage(formData, image);
    return requestMultipart('/visitors', { method: 'POST', formData, buildingId });
  },
  respondToVisitor: (id, action, buildingId) =>
    request(`/visitors/${id}/respond`, { method: 'PATCH', body: { action }, buildingId }),
  markVisitorExit: (id, buildingId) => request(`/visitors/${id}/exit`, { method: 'PATCH', buildingId }),
  getFacilities: (buildingId) => request('/facilities', { buildingId }),
  getFacilityAvailability: (facilityId, date, buildingId) =>
    request(`/facilities/${facilityId}/availability?date=${date}`, { buildingId }),
  bookFacility: (facilityId, payload, buildingId) =>
    request(`/facilities/${facilityId}/bookings`, { method: 'POST', body: payload, buildingId }),
  getMyFacilityBookings: (buildingId) => request('/facilities/bookings', { buildingId }),
  cancelFacilityBooking: (bookingId, buildingId) =>
    request(`/facilities/bookings/${bookingId}/cancel`, { method: 'PATCH', buildingId }),
  getVotes: (buildingId) => request('/votes', { buildingId }),
  respondToVote: (voteId, optionId, buildingId) => request(`/votes/${voteId}/options/${optionId}/respond`, { method: 'POST', buildingId }),
  getAnnouncements: (buildingId) => request('/announcements', { buildingId }),
  getEmergencyContacts: (buildingId) => request('/emergency-contacts', { buildingId }),
  triggerSOS: (buildingId) => request('/emergency-contacts/sos', { method: 'POST', buildingId }),
  getActiveSosAlerts: (buildingId) => request('/emergency-contacts/sos/active', { buildingId }),
  acknowledgeSos: (id, buildingId) =>
    request(`/emergency-contacts/sos/${id}/ack`, { method: 'PATCH', buildingId }),
  getBuildingFlats: (buildingId) => request(`/buildings/${buildingId}/flats`, { buildingId }),
  getMarketplace: (buildingId) => request('/marketplace', { buildingId }),
  getMyMarketplaceListings: (buildingId) => request('/marketplace/mine', { buildingId }),
  postListing: (payload, buildingId) => request('/marketplace', { method: 'POST', body: payload, buildingId }),
  deleteListing: (id, buildingId) => request(`/marketplace/${id}`, { method: 'DELETE', buildingId }),
  getNotifications: (buildingId) => request('/notifications', { buildingId }),
  getUnreadNotificationCount: (buildingId) => request('/notifications/unread-count', { buildingId }),
  markNotificationRead: (id, buildingId) =>
    request(`/notifications/${id}/read`, { method: 'PATCH', buildingId }),
  markAllNotificationsRead: (buildingId) =>
    request('/notifications/read-all', { method: 'PATCH', buildingId }),
  getFamilyMembers: (buildingId) => request('/family-members', { buildingId }),
  getFamilyOverview: (buildingId) => request('/family-members/overview', { buildingId }),
  addFamilyMember: (payload, buildingId) => request('/family-members', { method: 'POST', body: payload, buildingId }),
  deleteFamilyMember: (id, buildingId) => request(`/family-members/${id}`, { method: 'DELETE', buildingId }),
  revokeFamilyMember: (id, buildingId) => request(`/family-members/${id}/revoke`, { method: 'PATCH', buildingId }),
  changeFamilyPassword: (id, password, buildingId) =>
    request(`/family-members/${id}/password`, { method: 'PATCH', body: { password }, buildingId }),
  getVehicles: (buildingId) => request('/vehicles', { buildingId }),
  addVehicle: (payload, buildingId) => request('/vehicles', { method: 'POST', body: payload, buildingId }),
  createBugReport: async (payload, buildingId, image) => {
    if (!image) {
      return request('/bugs', { method: 'POST', body: payload, buildingId });
    }
    const formData = new FormData();
    formData.append('category', payload.category);
    formData.append('message', payload.message);
    formData.append('source', payload.source || 'mobile');
    await appendImage(formData, image);
    return requestMultipart('/bugs', { method: 'POST', formData, buildingId });
  },
  chatSupport: (query, userRole, buildingId) =>
    request('/api/v1/chat/support', { method: 'POST', body: { query, userRole }, buildingId })
};
