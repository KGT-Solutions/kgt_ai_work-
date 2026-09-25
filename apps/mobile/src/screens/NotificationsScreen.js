import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity, Platform
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography, layout } from '../theme';
import { ScreenHeader } from '../components/ScreenShell';
import { SkeletonList } from '../components/Skeleton';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { showError } from '../utils/alert';

const CATEGORY_META = {
  bill: { icon: 'cash-outline', bg: '#E8F5E9', color: '#2E7D32' },
  announcement: { icon: 'megaphone-outline', bg: '#FFF3E0', color: '#E65100' },
  visitor: { icon: 'person-outline', bg: '#E3F2FD', color: '#1565C0' },
  complaint: { icon: 'construct-outline', bg: '#F3E5F5', color: '#6A1B9A' },
  facility: { icon: 'calendar-outline', bg: '#FFF8E1', color: '#F57F17' },
  delivery: { icon: 'cube-outline', bg: '#FCE4EC', color: '#C2185B' },
  sos: { icon: 'warning-outline', bg: '#FFEBEE', color: '#C62828' },
  general: { icon: 'notifications-outline', bg: '#F5F5F5', color: '#616161' }
};

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function groupNotifications(items) {
  const today = startOfDay(new Date());
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups = { Today: [], 'This week': [], Earlier: [] };
  for (const item of items) {
    const d = new Date(item.createdAt);
    if (d >= today) groups.Today.push(item);
    else if (d >= weekAgo) groups['This week'].push(item);
    else groups.Earlier.push(item);
  }
  return Object.entries(groups)
    .filter(([, data]) => data.length > 0)
    .map(([title, data]) => ({ title, data }));
}

function formatWhen(iso) {
  const d = new Date(iso);
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d >= today) {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }
  if (d >= yesterday) return 'Yesterday';
  const diffDays = Math.floor((today - startOfDay(d)) / (24 * 60 * 60 * 1000));
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function NotificationsScreen() {
  const { activeBuildingId, activeMembership } = useAuth();
  const isGuard = activeMembership?.role === 'guard';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.getNotifications(activeBuildingId));
    } catch (e) {
      setItems([]);
      showError(e.message || 'Could not load notifications');
    } finally {
      setLoading(false);
    }
  }, [activeBuildingId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const id = 'notifications-hide-v-scroll';
    if (document.getElementById(id)) return undefined;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = '#notifications-scroll::-webkit-scrollbar,#notifications-scroll *::-webkit-scrollbar{display:none;width:0;height:0;}';
    document.head.appendChild(style);
    return undefined;
  }, []);

  const sections = useMemo(() => groupNotifications(items), [items]);
  const unreadCount = items.filter((n) => !n.read).length;

  const openItem = async (item) => {
    if (!item.read) {
      try {
        await api.markNotificationRead(item.id, activeBuildingId);
        setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
      } catch {
        // ignore
      }
    }
  };

  const markAllRead = async () => {
    try {
      await api.markAllNotificationsRead(activeBuildingId);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (e) {
      showError(e.message || 'Could not mark notifications read');
    }
  };

  if (loading) {
    return (
      <View style={[layout.screen, layout.screenPad, isGuard && styles.screenGuard]}>
        <ScreenHeader title="Notifications" locationLabel={activeMembership?.buildingName || 'Your society'} />
        <SkeletonList count={6} />
      </View>
    );
  }

  return (
    <View style={[layout.screen, isGuard && styles.screenGuard]}>
      <View style={[layout.screenPad, { paddingBottom: 0 }]}>
        <ScreenHeader
          title="Notifications"
          locationLabel={activeMembership?.buildingName || 'Your society'}
          headerRight={unreadCount > 0 ? (
            <TouchableOpacity onPress={markAllRead}>
              <Text style={styles.markAll}>Mark read</Text>
            </TouchableOpacity>
          ) : null}
        />
      </View>

      <SectionList
        nativeID="notifications-scroll"
        style={Platform.OS === 'web' ? styles.listWeb : undefined}
        sections={sections}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.list}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Ionicons name="notifications-off-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No notifications yet</Text>
            <Text style={styles.emptyText}>Updates about visitors, bills, announcements, and complaints will appear here.</Text>
          </View>
        }
        renderSectionHeader={({ section: { title } }) => (
          <Text style={styles.sectionHeader}>{title}</Text>
        )}
        renderItem={({ item }) => (
          <NotificationRow item={item} onPress={() => openItem(item)} />
        )}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

function NotificationRow({ item, onPress }) {
  const meta = CATEGORY_META[item.category] || CATEGORY_META.general;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      {!item.read && <View style={styles.unreadDot} />}
      <View style={[styles.iconWrap, { backgroundColor: meta.bg }]}>
        <Ionicons name={meta.icon} size={20} color={meta.color} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.itemTitle, !item.read && styles.itemTitleUnread]} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.itemBody} numberOfLines={2}>{item.body}</Text>
      </View>
      <View style={styles.trailing}>
        <Text style={styles.time}>{formatWhen(item.createdAt)}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screenGuard: { backgroundColor: 'transparent' },
  listWeb: { flex: 1, scrollbarWidth: 'none', msOverflowStyle: 'none' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  markAll: { fontSize: 13, color: colors.accent, fontWeight: '600', marginTop: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 96 },
  emptyContainer: { flexGrow: 1, padding: spacing.lg },
  sectionHeader: {
    fontSize: 13, fontWeight: '600', color: colors.textMuted,
    marginTop: spacing.md, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5
  },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border, gap: spacing.sm
  },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent,
    position: 'absolute', left: 6, top: '50%', marginTop: -4, zIndex: 1
  },
  iconWrap: {
    width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center'
  },
  content: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  itemTitleUnread: { color: colors.primary },
  itemBody: { fontSize: 12, color: colors.textMuted, marginTop: 3, lineHeight: 17 },
  trailing: { alignItems: 'flex-end', gap: 4 },
  time: { fontSize: 11, color: colors.textMuted },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, marginTop: spacing.md },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 20, maxWidth: 280 }
});
