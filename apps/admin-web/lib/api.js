import { ADMIN_MEMBERSHIP_ROLES } from './memberships';

export const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export function mediaUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${BASE_URL}${path}`;
}

function getToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem('token');
}

function getMembershipIdForBuilding(buildingId) {
  if (typeof window === 'undefined' || !buildingId) return null;
  try {
    const memberships = JSON.parse(window.localStorage.getItem('memberships') || '[]');
    const match = memberships.find(
      (m) => m.buildingId === buildingId && ADMIN_MEMBERSHIP_ROLES.includes(m.role)
    );
    return match?.id || null;
  } catch {
    return null;
  }
}

async function request(path, { method = 'GET', body, buildingId } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (buildingId) headers['X-Building-Id'] = buildingId;
  const membershipId = getMembershipIdForBuilding(buildingId);
  if (membershipId) headers['X-Membership-Id'] = membershipId;

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
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (buildingId) headers['X-Building-Id'] = buildingId;
  const membershipId = getMembershipIdForBuilding(buildingId);
  if (membershipId) headers['X-Membership-Id'] = membershipId;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: formData
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function appendFields(formData, payload = {}) {
  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined) return;
    if (value === null) {
      formData.append(key, '');
      return;
    }
    if (typeof value === 'boolean') {
      formData.append(key, value ? 'true' : 'false');
      return;
    }
    if (Array.isArray(value)) {
      formData.append(key, JSON.stringify(value));
      return;
    }
    formData.append(key, String(value));
  });
}

async function financeWithOptionalImage(path, { method, payload, imageFile, buildingId }) {
  if (!imageFile) {
    return request(path, { method, body: payload, buildingId });
  }
  const formData = new FormData();
  appendFields(formData, payload);
  formData.append('image', imageFile);
  return requestMultipart(path, { method, formData, buildingId });
}

export const api = {
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
  loginPassword: (phone, password, { surface } = {}) =>
    request('/auth/login-password', {
      method: 'POST',
      body: { phone, password, ...(surface ? { surface } : {}) }
    }),
  getMe: () => request('/auth/me'),
  listBuildings: () => request('/buildings'),
  createBuilding: (payload) => request('/buildings', { method: 'POST', body: payload }),
  updateBuildingAdmin: (buildingId, payload) =>
    request(`/buildings/${buildingId}/admin`, { method: 'PATCH', body: payload }),
  deleteBuilding: (buildingId) =>
    request(`/buildings/${buildingId}`, { method: 'DELETE' }),
  getDashboard: (buildingId) => request(`/buildings/${buildingId}/dashboard`, { buildingId }),
  getFlats: (buildingId) => request(`/buildings/${buildingId}/flats`, { buildingId }),
  getWings: (buildingId) => request(`/buildings/${buildingId}/wings`, { buildingId }),
  createWing: (buildingId, payload) =>
    request(`/buildings/${buildingId}/wings`, { method: 'POST', body: payload, buildingId }),
  addFlatRange: (buildingId, payload) =>
    request(`/buildings/${buildingId}/flats/range`, { method: 'POST', body: payload, buildingId }),
  deleteFlat: (buildingId, flatId) =>
    request(`/buildings/${buildingId}/flats/${flatId}`, { method: 'DELETE', buildingId }),
  updateFlat: (buildingId, flatId, payload) =>
    request(`/buildings/${buildingId}/flats/${flatId}`, { method: 'PATCH', body: payload, buildingId }),
  getApprovals: (buildingId) => request(`/buildings/${buildingId}/approvals`, { buildingId }),
  setApproval: (buildingId, membershipId, status) =>
    request(`/buildings/${buildingId}/approvals/${membershipId}`, { method: 'PATCH', body: { status }, buildingId }),
  getFamilyApprovals: (buildingId) => request('/family-members/approvals', { buildingId }),
  getPendingFamilyCount: (buildingId) => request('/family-members/approvals/count', { buildingId }),
  reviewFamilyMember: (buildingId, memberId, status) =>
    request(`/family-members/${memberId}/review`, { method: 'PATCH', body: { status }, buildingId }),
  getComplaints: (buildingId) => request('/complaints', { buildingId }),
  updateComplaint: (buildingId, id, status) =>
    request(`/complaints/${id}`, { method: 'PATCH', body: { status }, buildingId }),
  getAnnouncements: (buildingId) => request('/announcements', { buildingId }),
  createAnnouncement: (buildingId, payload) =>
    request('/announcements', { method: 'POST', body: payload, buildingId }),
  getBills: async (buildingId) => {
    const data = await request('/bills', { buildingId });
    // Supports legacy array and new { bills, account } shape
    if (Array.isArray(data)) return data;
    return data.bills || [];
  },
  getBillsWithAccount: (buildingId) => request('/bills', { buildingId }),
  createBill: (buildingId, payload) =>
    request('/bills', { method: 'POST', body: payload, buildingId }),
  createBulkBills: (buildingId, payload) =>
    request('/bills/bulk', { method: 'POST', body: payload, buildingId }),
  markBillPaid: (buildingId, billId) =>
    request(`/bills/${billId}/mark-paid`, { method: 'PATCH', buildingId }),
  getMaintenanceConfig: (buildingId) =>
    request('/finance/maintenance-config', { buildingId }),
  saveMaintenanceConfig: (buildingId, payload, imageFile) =>
    financeWithOptionalImage('/finance/maintenance-config', {
      method: 'PUT',
      payload,
      imageFile,
      buildingId
    }),
  savePaymentQr: (buildingId, imageFile) => {
    if (!imageFile) return Promise.reject(new Error('Society UPI / QR image is required'));
    const formData = new FormData();
    formData.append('image', imageFile);
    return requestMultipart('/finance/payment-qr', {
      method: 'POST',
      formData,
      buildingId
    });
  },
  generateMaintenance: (buildingId, payload = {}) =>
    request('/finance/generate-maintenance', { method: 'POST', body: payload, buildingId }),
  getFlatAccounts: (buildingId) =>
    request('/finance/flat-accounts', { buildingId }),
  getFlatLedger: (buildingId, flatId) =>
    request(`/finance/flat-accounts/${flatId}/ledger`, { buildingId }),
  recordFinancePayment: (buildingId, payload, imageFile) =>
    financeWithOptionalImage('/finance/payments', {
      method: 'POST',
      payload,
      imageFile,
      buildingId
    }),
  getSocietyExpenses: (buildingId) =>
    request('/finance/expenses', { buildingId }),
  createSocietyExpense: (buildingId, payload, imageFile) =>
    financeWithOptionalImage('/finance/expenses', {
      method: 'POST',
      payload,
      imageFile,
      buildingId
    }),
  updateSocietyExpense: (buildingId, expenseId, payload, imageFile) =>
    financeWithOptionalImage(`/finance/expenses/${expenseId}`, {
      method: 'PATCH',
      payload,
      imageFile,
      buildingId
    }),
  deleteSocietyExpense: (buildingId, expenseId) =>
    request(`/finance/expenses/${expenseId}`, { method: 'DELETE', buildingId }),
  getFundSummary: (buildingId) =>
    request('/finance/fund-summary', { buildingId }),
  getPaymentReviews: (buildingId) =>
    request('/finance/payment-reviews', { buildingId }),
  approvePaymentReview: (buildingId, paymentId) =>
    request(`/finance/payment-reviews/${paymentId}/approve`, { method: 'POST', buildingId }),
  rejectPaymentReview: (buildingId, paymentId) =>
    request(`/finance/payment-reviews/${paymentId}/reject`, { method: 'POST', buildingId }),
  getVisitors: (buildingId, scope = 'today') =>
    request(`/visitors?scope=${scope}`, { buildingId }),
  getFacilities: (buildingId) => request('/facilities', { buildingId }),
  getFacilitiesManage: (buildingId) => request('/facilities/manage', { buildingId }),
  createFacility: (buildingId, payload) =>
    request('/facilities', { method: 'POST', body: payload, buildingId }),
  updateFacility: (buildingId, id, payload) =>
    request(`/facilities/${id}`, { method: 'PATCH', body: payload, buildingId }),
  deleteFacility: (buildingId, id) =>
    request(`/facilities/${id}`, { method: 'DELETE', buildingId }),
  getFacilityBookings: (buildingId, status) =>
    request(`/facilities/bookings${status ? `?status=${status}` : ''}`, { buildingId }),
  updateFacilityBooking: (buildingId, bookingId, status) =>
    request(`/facilities/bookings/${bookingId}`, { method: 'PATCH', body: { status }, buildingId }),
  getVotes: (buildingId) => request('/votes', { buildingId }),
  createVote: (buildingId, payload) =>
    request('/votes', { method: 'POST', body: payload, buildingId }),
  updateVote: (buildingId, voteId, payload) =>
    request(`/votes/${voteId}`, { method: 'PATCH', body: payload, buildingId }),
  deleteVote: (buildingId, voteId) =>
    request(`/votes/${voteId}`, { method: 'DELETE', buildingId }),
  getDirectoryContacts: (buildingId) => request('/emergency-contacts', { buildingId }),
  createDirectoryContact: (buildingId, payload) =>
    request('/emergency-contacts', { method: 'POST', body: payload, buildingId }),
  updateDirectoryContact: (buildingId, contactId, payload) =>
    request(`/emergency-contacts/${contactId}`, { method: 'PATCH', body: payload, buildingId }),
  deleteDirectoryContact: (buildingId, contactId) =>
    request(`/emergency-contacts/${contactId}`, { method: 'DELETE', buildingId }),
  getVehiclesManage: (buildingId, { status, category } = {}) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (category) params.set('category', category);
    const qs = params.toString();
    return request(`/vehicles/manage${qs ? `?${qs}` : ''}`, { buildingId });
  },
  getPendingVehicleCount: (buildingId) => request('/vehicles/pending-count', { buildingId }),
  updateVehicleStatus: (buildingId, vehicleId, status) =>
    request(`/vehicles/${vehicleId}/status`, { method: 'PATCH', body: { status }, buildingId }),
  getNotifications: (buildingId) => request('/notifications', { buildingId }),
  getUnreadNotificationCount: (buildingId) =>
    request('/notifications/unread-count', { buildingId }),
  markNotificationRead: (buildingId, id) =>
    request(`/notifications/${id}/read`, { method: 'PATCH', buildingId }),
  markAllNotificationsRead: (buildingId) =>
    request('/notifications/read-all', { method: 'PATCH', buildingId }),
  getOpenComplaintCount: (buildingId) =>
    request('/complaints/open-count', { buildingId }),
  createBugReport: (buildingId, payload) =>
    request('/bugs', { method: 'POST', body: payload, buildingId }),
  listBugReports: (params = {}) => {
    const q = new URLSearchParams();
    if (params.status) q.set('status', params.status);
    if (params.buildingId) q.set('buildingId', params.buildingId);
    if (params.roleKey) q.set('roleKey', params.roleKey);
    const qs = q.toString();
    return request(`/bugs${qs ? `?${qs}` : ''}`);
  },
  updateBugReport: (id, status) =>
    request(`/bugs/${id}`, { method: 'PATCH', body: { status } }),
  listSalesLeads: ({ page, pageSize, sortBy, order, clientType, minIntentScore } = {}) => {
    const q = new URLSearchParams();
    if (page) q.set('page', page);
    if (pageSize) q.set('pageSize', pageSize);
    if (sortBy) q.set('sortBy', sortBy);
    if (order) q.set('order', order);
    if (clientType) q.set('clientType', clientType);
    if (minIntentScore !== undefined && minIntentScore !== '') q.set('minIntentScore', minIntentScore);
    const qs = q.toString();
    return request(`/api/v1/sales-leads${qs ? `?${qs}` : ''}`);
  },
  listTenants: () => request('/api/v1/tenants'),
  createTenant: (payload) => request('/api/v1/tenants', { method: 'POST', body: payload }),
  getTenant: (tenantId) => request(`/api/v1/tenants/${tenantId}`),
  updateTenant: (tenantId, payload) => request(`/api/v1/tenants/${tenantId}`, { method: 'PATCH', body: payload }),
  getTenantDocuments: (tenantId) => request(`/api/v1/tenants/${tenantId}/documents`),
  createTenantDocument: (tenantId, payload) =>
    request(`/api/v1/tenants/${tenantId}/documents`, { method: 'POST', body: payload }),
  updateTenantDocument: (tenantId, documentId, payload) =>
    request(`/api/v1/tenants/${tenantId}/documents/${documentId}`, { method: 'PATCH', body: payload }),
  deleteTenantDocument: (tenantId, documentId) =>
    request(`/api/v1/tenants/${tenantId}/documents/${documentId}`, { method: 'DELETE' }),
  scrapeTenantUrl: (tenantId, url) =>
    request(`/api/v1/tenants/${tenantId}/scrape`, { method: 'POST', body: { url } }),

  // Public self-serve registration wizard (pages/register.js) — no auth
  // token exists yet at this point, so these deliberately don't need one;
  // see apps/api/src/routes/publicRegister.routes.js.
  // authorized: the visitor ticked the crawl-authorization box — the API refuses to crawl without it.
  analyzeCompanyUrl: (url, { authorized } = {}) =>
    request('/api/v1/public/register/analyze', { method: 'POST', body: { url, authorized: authorized === true } }),
  analyzeCompanyPdf: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return requestMultipart('/api/v1/public/register/analyze-pdf', { formData });
  },
  completeRegistration: (payload) => request('/api/v1/public/register/complete', { method: 'POST', body: payload }),
  getTenantTickets: (tenantId) => request(`/api/v1/tenants/${tenantId}/tickets`),
  getTenantUsage: (tenantId) => request(`/api/v1/tenants/${tenantId}/usage`)
};
