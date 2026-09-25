import React, { useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, StatusBar, BackHandler } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import BrandLogo from '../components/BrandLogo';
import { colors, spacing, radius, shadow, layout } from '../theme';
import { useAuth } from '../context/AuthContext';

export default function SelectSocietyScreen() {
  const { user, memberships, setActiveMembershipId, restoreLastMembership, logout } = useAuth();

  const goBack = useCallback(async () => {
    const restored = await restoreLastMembership();
    if (!restored) await logout();
  }, [restoreLastMembership, logout]);

  useEffect(() => {
    if (memberships.length === 1) {
      setActiveMembershipId(memberships[0].id);
    }
  }, [memberships, setActiveMembershipId]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [goBack]);

  const topPad = Platform.OS === 'android'
    ? (StatusBar.currentHeight || 12)
    : Platform.OS === 'web'
      ? 8
      : 0;

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={[styles.content, topPad ? { paddingTop: spacing.lg + topPad } : null]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.shell}>
        <BrandLogo variant="wordmark-color" height={36} style={styles.logo} />
        <View style={styles.titleRow}>
          <TouchableOpacity
            onPress={goBack}
            style={styles.backBtn}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={22} color={colors.primary} />
          </TouchableOpacity>
          <Text style={styles.title}>Choose your flat</Text>
        </View>
        <Text style={styles.subtitle}>
          {user?.name ? `${user.name.split(' ')[0]}, this ` : 'This '}
          number is linked to more than one flat. Open the home you want to use.
        </Text>

        <View style={styles.grid}>
          {memberships.map((m) => {
            const flatLabel = m.flat ? `Flat ${m.flat}` : 'Your flat';
            const mark = (m.flat || m.buildingName || 'F').charAt(0).toUpperCase();
            return (
              <TouchableOpacity
                key={m.id}
                style={styles.card}
                onPress={() => setActiveMembershipId(m.id)}
                activeOpacity={0.88}
              >
                <View style={styles.cardMark}>
                  <Text style={styles.cardMarkText}>{mark}</Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.cardName} numberOfLines={1}>{flatLabel}</Text>
                  <Text style={styles.cardSociety} numberOfLines={1}>
                    {m.buildingName || 'Society'}
                  </Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {[
                      m.floor != null ? `Floor ${m.floor}` : null,
                      m.buildingCode
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.primary} />
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity style={styles.logout} onPress={logout} activeOpacity={0.88}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: 'transparent' },
  content: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: 48,
    alignItems: 'center'
  },
  shell: {
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 360 : layout.desktopMaxWidth
  },
  logo: { marginBottom: spacing.md, alignSelf: 'flex-start' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft
  },
  title: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: colors.primaryInk,
    letterSpacing: -0.4
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 8,
    marginBottom: spacing.lg,
    lineHeight: 20
  },
  grid: { gap: 12 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card
  },
  cardMark: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary
  },
  cardMarkText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800'
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.primaryInk
  },
  cardSociety: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textBody
  },
  cardMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '500',
    color: colors.textMuted
  },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: spacing.xl,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#F5D0CC'
  },
  logoutText: { color: colors.error, fontWeight: '600', fontSize: 14 }
});
