import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';

const AuthContext = createContext(null);

function surfaceForRole(role) {
  return role === 'guard' ? 'guard' : 'mobile';
}

function filterMembershipsByRole(memberships, role) {
  if (!role) return memberships || [];
  return (memberships || []).filter((m) => m.role === role);
}

function errorForRole(role) {
  if (role === 'guard') {
    return 'This account is not a guard for the selected building.';
  }
  return 'No resident access for this number. Sign in with a resident account, or wait for admin approval.';
}

function pickDefaultMembership(memberships, preferredBuildingId, preferredMembershipId) {
  if (preferredMembershipId) {
    const byId = memberships.find((m) => m.id === preferredMembershipId);
    if (byId) return byId;
  }
  if (preferredBuildingId) {
    const byBuilding = memberships.find((m) => m.buildingId === preferredBuildingId);
    if (byBuilding) return byBuilding;
  }
  if (memberships.length === 1) return memberships[0];
  return null;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [memberships, setMemberships] = useState([]);
  const [activeBuildingId, setActiveBuildingIdState] = useState(null);
  const [activeMembershipId, setActiveMembershipIdState] = useState(null);
  const [lastMembershipId, setLastMembershipIdState] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem('session');
      if (stored) {
        const session = JSON.parse(stored);
        const inferredRole =
          session.loginRole
          || (session.memberships || []).find((m) => m.id === session.activeMembershipId)?.role
          || 'resident';
        const loginRole = inferredRole === 'guard' ? 'guard' : 'resident';
        const scoped = filterMembershipsByRole(session.memberships, loginRole);
        if (!scoped.length) {
          await AsyncStorage.multiRemove(['token', 'session']);
          setLoading(false);
          return;
        }
        const picked = pickDefaultMembership(
          scoped,
          session.activeBuildingId,
          session.activeMembershipId
        );
        setUser(session.user);
        setMemberships(scoped);
        setActiveBuildingIdState(picked?.buildingId || null);
        setActiveMembershipIdState(picked?.id || null);
        setLastMembershipIdState(session.lastMembershipId || null);
        if (
          session.loginRole !== loginRole
          || scoped.length !== (session.memberships || []).length
          || picked?.id !== session.activeMembershipId
        ) {
          await AsyncStorage.setItem(
            'session',
            JSON.stringify({
              user: session.user,
              memberships: scoped,
              activeBuildingId: picked?.buildingId || null,
              activeMembershipId: picked?.id || null,
              lastMembershipId: session.lastMembershipId || null,
              loginRole
            })
          );
        }
      }
      setLoading(false);
    })();
  }, []);

  const persistSession = async (nextUser, nextMemberships, buildingId, membershipId, loginRole, nextLastMembershipId = null) => {
    await AsyncStorage.setItem(
      'session',
      JSON.stringify({
        user: nextUser,
        memberships: nextMemberships,
        activeBuildingId: buildingId,
        activeMembershipId: membershipId,
        lastMembershipId: nextLastMembershipId,
        loginRole
      })
    );
    setUser(nextUser);
    setMemberships(nextMemberships);
    setActiveBuildingIdState(buildingId);
    setActiveMembershipIdState(membershipId);
    setLastMembershipIdState(nextLastMembershipId);
  };

  const completeLogin = async (data, preferredBuildingId, options = {}) => {
    const loginRole = options.requireRole || 'resident';
    const scoped = filterMembershipsByRole(data.memberships, loginRole);
    if (!scoped.length) {
      throw new Error(errorForRole(loginRole));
    }
    const membership = pickDefaultMembership(scoped, preferredBuildingId, null);
    if (preferredBuildingId && (!membership || membership.buildingId !== preferredBuildingId)) {
      throw new Error('No access for this building. Check your building selection or wait for admin approval.');
    }
    if (!membership && scoped.length < 2) {
      throw new Error(errorForRole(loginRole));
    }
    await AsyncStorage.setItem('token', data.token);
    await persistSession(
      data.user,
      scoped,
      membership?.buildingId || null,
      membership?.id || null,
      loginRole
    );
  };

  const login = async (phone, otp, preferredBuildingId, options = {}) => {
    const loginRole = options.requireRole || 'resident';
    const data = await api.verifyOtp(phone, otp, { surface: surfaceForRole(loginRole) });
    await completeLogin(data, preferredBuildingId, { requireRole: loginRole });
  };

  const devLogin = async (phone) => {
    const data = await api.devLogin(phone, { surface: 'mobile' });
    await completeLogin(data, null, { requireRole: 'resident' });
  };

  const loginWithPassword = async (phone, password, preferredBuildingId, options = {}) => {
    const loginRole = options.requireRole || 'resident';
    const data = await api.loginWithPassword(phone, password, { surface: surfaceForRole(loginRole) });
    await completeLogin(data, preferredBuildingId, { requireRole: loginRole });
  };

  const setActiveMembershipId = async (membershipId) => {
    const membership = memberships.find((m) => m.id === membershipId);
    if (!membership) return;
    const loginRole = membership.role === 'guard' ? 'guard' : 'resident';
    await persistSession(user, memberships, membership.buildingId, membership.id, loginRole);
  };

  const setActiveBuildingId = async (buildingId) => {
    const membership = memberships.find((m) => m.buildingId === buildingId);
    if (!membership) return;
    const loginRole = membership.role === 'guard' ? 'guard' : 'resident';
    await persistSession(user, memberships, membership.buildingId, membership.id, loginRole);
  };

  const clearActiveMembership = async () => {
    if (!user) return;
    const stored = await AsyncStorage.getItem('session');
    let loginRole = 'resident';
    if (stored) {
      try {
        loginRole = JSON.parse(stored).loginRole || 'resident';
      } catch {
        loginRole = 'resident';
      }
    }
    await persistSession(user, memberships, null, null, loginRole, activeMembershipId || null);
  };

  const restoreLastMembership = async () => {
    if (!lastMembershipId) return false;
    const membership = memberships.find((m) => m.id === lastMembershipId);
    if (!membership) return false;
    const loginRole = membership.role === 'guard' ? 'guard' : 'resident';
    await persistSession(user, memberships, membership.buildingId, membership.id, loginRole, null);
    return true;
  };

  const logout = async () => {
    await AsyncStorage.multiRemove(['token', 'session']);
    setUser(null);
    setMemberships([]);
    setActiveBuildingIdState(null);
    setActiveMembershipIdState(null);
    setLastMembershipIdState(null);
  };

  const updateUser = async (nextUser) => {
    const stored = await AsyncStorage.getItem('session');
    if (!stored) return;
    const session = JSON.parse(stored);
    session.user = { ...session.user, ...nextUser };
    await AsyncStorage.setItem('session', JSON.stringify(session));
    setUser(session.user);
  };

  const activeMembership =
    memberships.find((m) => m.id === activeMembershipId) ||
    memberships.find((m) => m.buildingId === activeBuildingId) ||
    null;

  const buildingMemberships = memberships.filter(
    (m) => m.buildingId === (activeMembership?.buildingId || activeBuildingId)
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        memberships,
        buildingMemberships,
        activeBuildingId,
        activeMembershipId,
        activeMembership,
        loading,
        login,
        devLogin,
        loginWithPassword,
        logout,
        setActiveBuildingId,
        setActiveMembershipId,
        clearActiveMembership,
        restoreLastMembership,
        updateUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
