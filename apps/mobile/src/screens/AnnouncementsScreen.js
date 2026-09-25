import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, SectionList } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';
import ResidentScreenHeader from '../components/ResidentScreenHeader';
import Card from '../components/Card';
import StatusPill from '../components/StatusPill';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const VARIANT = {
  general: 'success',
  maintenance: 'warning',
  event: 'neutral',
  urgent: 'error'
};

const CATEGORY_LABEL = {
  general: 'General',
  maintenance: 'Maintenance',
  event: 'Event',
  urgent: 'Urgent'
};

function sortAnnouncements(items) {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return Number(b.pinned) - Number(a.pinned);
    return new Date(b.postedAt) - new Date(a.postedAt);
  });
}

function getDateSection(dateStr) {
  const posted = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(posted.getFullYear(), posted.getMonth(), posted.getDate());
  const diffDays = Math.floor((today - day) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return 'This week';
  return 'Earlier';
}

function buildSections(items) {
  const sorted = sortAnnouncements(items);
  const pinned = sorted.filter((a) => a.pinned);
  const rest = sorted.filter((a) => !a.pinned);
  const sections = [];

  if (pinned.length) {
    sections.push({ title: 'Pinned', data: pinned });
  }

  const groups = new Map();
  for (const item of rest) {
    const key = getDateSection(item.postedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  for (const title of ['Today', 'Yesterday', 'This week', 'Earlier']) {
    if (groups.has(title)) sections.push({ title, data: groups.get(title) });
  }

  return sections;
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function AnnouncementCard({ item }) {
  const category = item.category || 'general';
  return (
    <Card style={styles.card}>
      <View style={styles.cardTop}>
        <StatusPill label={CATEGORY_LABEL[category] || category} variant={VARIANT[category] || 'neutral'} />
        {item.pinned && (
          <View style={styles.pinnedBadge}>
            <Ionicons name="pin" size={12} color={colors.warning} />
            <Text style={styles.pinnedText}>Pinned</Text>
          </View>
        )}
      </View>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.body}>{item.body}</Text>
      <View style={styles.metaRow}>
        <Ionicons name="time-outline" size={14} color={colors.textMuted} />
        <Text style={styles.metaText}>{formatDateTime(item.postedAt)}</Text>
      </View>
    </Card>
  );
}

export default function AnnouncementsScreen({ navigation }) {
  const { activeBuildingId, activeMembership } = useAuth();
  const [items, setItems] = useState([]);

  const load = useCallback(async () => {
    if (!activeBuildingId) return;
    setItems(await api.getAnnouncements(activeBuildingId));
  }, [activeBuildingId]);

  useFocusEffect(useCallback(() => { load().catch(() => {}); }, [load]));

  const sections = useMemo(() => buildSections(items), [items]);
  const locationLabel = [
    activeMembership?.buildingName,
    activeMembership?.flat
  ].filter(Boolean).join(' · ') || 'Your society';

  return (
    <View style={styles.container}>
      <ResidentScreenHeader
        navigation={navigation}
        title="Announcements"
        locationLabel={locationLabel}
        showBack
      />
      <SectionList
        style={styles.list}
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={(
          <Text style={styles.summary}>
            {items.length === 0
              ? 'Updates from your building admin will appear here.'
              : `${items.length} announcement${items.length === 1 ? '' : 's'} · newest first`}
          </Text>
        )}
        renderSectionHeader={({ section: { title } }) => (
          <Text style={styles.sectionLabel}>{title}</Text>
        )}
        renderItem={({ item }) => <AnnouncementCard item={item} />}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="megaphone-outline" size={32} color={colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No announcements yet</Text>
            <Text style={styles.emptyText}>
              When your society admin posts updates about events, maintenance, or notices, they will show up here with date and time.
            </Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, flexGrow: 1 },
  summary: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.md },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase',
    letterSpacing: 0.8, marginBottom: spacing.sm, marginTop: spacing.sm
  },
  card: { marginBottom: spacing.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  pinnedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pinnedText: { fontSize: 12, fontWeight: '600', color: colors.warning },
  title: { fontSize: 17, fontWeight: '700', color: colors.primary, lineHeight: 24 },
  body: { color: colors.text, fontSize: 14, lineHeight: 22, marginTop: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  metaText: { fontSize: 12, color: colors.textMuted, fontWeight: '500' },
  empty: {
    alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.md,
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border
  },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: '#FDF3E7',
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.primary, marginBottom: spacing.sm },
  emptyText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 }
});
