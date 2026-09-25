export const ADMIN_MEMBERSHIP_ROLES = ['building_admin', 'committee_member'];

export function filterAdminMemberships(memberships) {
  return (memberships || []).filter((m) => ADMIN_MEMBERSHIP_ROLES.includes(m.role));
}

export function adminRoleLabel(role) {
  if (role === 'building_admin') return 'Building admin';
  if (role === 'committee_member') return 'Committee';
  return role || 'Admin';
}

export function readStoredAdminMemberships() {
  if (typeof window === 'undefined') return [];
  try {
    return filterAdminMemberships(JSON.parse(window.localStorage.getItem('memberships') || '[]'));
  } catch {
    return [];
  }
}
