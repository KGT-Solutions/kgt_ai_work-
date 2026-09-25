import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Platform, StatusBar
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { showAlert } from '../utils/alert';
import { useAuth } from '../context/AuthContext';

/** Tokens from design-system.md */
const ds = {
  bg: '#f2f3f4',
  surface: '#ffffff',
  primary: '#2b3a49',
  primaryInk: '#1f2d3a',
  accent: '#7d9471',
  accentInk: '#5f7d52',
  danger: '#a9503f',
  text: '#1f2d3a',
  textBody: '#4b5563',
  textMuted: '#8a94a0',
  label: '#9aa4ae',
  border: '#e3e6e9',
  hairline: '#eceef0'
};

const EMERGENCY_CATEGORIES = new Set(['ambulance', 'police', 'fire']);

const DEFAULT_EMERGENCY = [
  { id: 'default-ambulance', name: 'Ambulance', phone: '108', category: 'ambulance' },
  { id: 'default-police', name: 'Police', phone: '100', category: 'police' },
  { id: 'default-fire', name: 'Fire', phone: '101', category: 'fire' }
];

/** Pastel icon tiles — design-system §1 + Figma category mapping */
const CATEGORY_META = {
  ambulance: { icon: 'medkit-outline', fill: '#f6dfd9', glyph: '#b0503f' },
  police: { icon: 'shield-outline', fill: '#e4ecf7', glyph: '#5b7fb0' },
  fire: { icon: 'flame-outline', fill: '#f7e9d8', glyph: '#c78a4a' },
  custom: { icon: 'call-outline', fill: '#e0ebdb', glyph: '#6d8f63' }
};

function ContactRow({ item, onCall, isLast }) {
  const meta = CATEGORY_META[item.category] || {
    icon: 'call-outline', fill: '#e9ebed', glyph: '#6b7280'
  };

  return (
    <View>
      <View style={styles.row}>
        <View style={[styles.iconTile, { backgroundColor: meta.fill }]}>
          <Ionicons name={meta.icon} size={18} color={meta.glyph} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{item.name}</Text>
          <Text style={styles.rowSubtitle}>{item.phone}</Text>
        </View>
        <TouchableOpacity
          style={styles.callBtn}
          onPress={() => onCall(item.phone)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Call ${item.name}`}
        >
          <Ionicons name="call" size={16} color={ds.accentInk} />
        </TouchableOpacity>
      </View>
      {!isLast && <View style={styles.divider} />}
    </View>
  );
}

function ContactSection({ title, items, onCall }) {
  if (!items.length) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      <View style={styles.card}>
        {items.map((item, index) => (
          <ContactRow
            key={item.id}
            item={item}
            onCall={onCall}
            isLast={index === items.length - 1}
          />
        ))}
      </View>
    </View>
  );
}

export default function EmergencyScreen({ navigation }) {
  const { activeMembership, activeBuildingId } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async () => {
    const [list, unread] = await Promise.all([
      api.getEmergencyContacts(activeBuildingId),
      api.getUnreadNotificationCount(activeBuildingId).catch(() => ({ count: 0 }))
    ]);
    setContacts(list);
    setUnreadCount(unread.count || 0);
  }, [activeBuildingId]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const { emergency, society } = useMemo(() => {
    const emergencyItems = [];
    const societyItems = [];
    contacts.forEach((contact) => {
      if (EMERGENCY_CATEGORIES.has(contact.category)) emergencyItems.push(contact);
      else societyItems.push(contact);
    });

    DEFAULT_EMERGENCY.forEach((fallback) => {
      if (!emergencyItems.some((item) => item.category === fallback.category)) {
        emergencyItems.push(fallback);
      }
    });

    emergencyItems.sort((a, b) => {
      const order = ['ambulance', 'police', 'fire'];
      return order.indexOf(a.category) - order.indexOf(b.category);
    });

    societyItems.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    return { emergency: emergencyItems, society: societyItems };
  }, [contacts]);

  const call = (phone) => Linking.openURL(`tel:${phone.replace(/\s/g, '')}`);

  const sos = async () => {
    const res = await api.triggerSOS(activeBuildingId);
    showAlert('SOS sent', res.message);
  };

  const locationLabel = activeMembership?.buildingName || 'Your society';

  const topPad = Platform.OS === 'android'
    ? (StatusBar.currentHeight || 12)
    : Platform.OS === 'web'
      ? 16
      : 8;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8 }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.chip}>
          <Ionicons name="business-outline" size={14} color={ds.accentInk} />
          <Text style={styles.chipText} numberOfLines={1}>{locationLabel}</Text>
          <Ionicons name="chevron-down" size={14} color={ds.accentInk} />
        </View>
        {navigation ? (
          <TouchableOpacity
            onPress={() => navigation.navigate('Notifications')}
            style={styles.bellBtn}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={22} color={ds.primary} />
            {unreadCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.sosSection}>
        <View style={styles.sosGlowOuter}>
          <View style={styles.sosGlow}>
            <TouchableOpacity
              style={styles.sosButton}
              onPress={sos}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Send SOS"
            >
              <Text style={styles.sosText}>SOS</Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.sosHeading}>Emergency help</Text>
        <Text style={styles.sosCaption}>Tap only in a real emergency.</Text>
      </View>

      <ContactSection title="Emergency services" items={emergency} onCall={call} />
      <ContactSection title="Society contacts" items={society} onCall={call} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: ds.bg
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    backgroundColor: ds.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    maxWidth: '82%',
    shadowColor: '#1f2d3a',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '500',
    color: ds.accentInk
  },
  bellBtn: {
    padding: 4,
    position: 'relative'
  },
  bellBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: ds.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3
  },
  bellBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700'
  },
  sosSection: {
    alignItems: 'center',
    marginBottom: 32
  },
  sosGlowOuter: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: 'rgba(125, 148, 113, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18
  },
  sosGlow: {
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: 'rgba(125, 148, 113, 0.18)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  sosButton: {
    width: 124,
    height: 124,
    borderRadius: 62,
    backgroundColor: ds.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: ds.accent,
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8
  },
  sosText: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 2
  },
  sosHeading: {
    fontSize: 20,
    fontWeight: '700',
    color: ds.primaryInk,
    marginBottom: 4
  },
  sosCaption: {
    fontSize: 13,
    color: ds.textMuted,
    fontWeight: '400'
  },
  section: {
    marginBottom: 22
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: ds.label,
    textTransform: 'uppercase',
    letterSpacing: 0.66,
    marginBottom: 10
  },
  card: {
    backgroundColor: ds.surface,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#1f2d3a',
    shadowOpacity: 0.15,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  iconTile: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  rowBody: { flex: 1 },
  rowTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: ds.primaryInk
  },
  rowSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: ds.accentInk,
    marginTop: 2
  },
  callBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(125, 148, 113, 0.12)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: ds.hairline,
    marginLeft: 68
  }
});
