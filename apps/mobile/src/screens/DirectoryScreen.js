import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Platform, StatusBar
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import BrandLogo from '../components/BrandLogo';
import { api } from '../api/client';
import { showAlert } from '../utils/alert';
import { useAuth } from '../context/AuthContext';

/** Tokens from design-system.md (Emerald Fresh) */
const ds = {
  surface: '#ffffff',
  primary: '#059669',
  primaryLight: '#34d39a',
  heading: '#06231a',
  secondary: '#2f5c4a',
  muted: '#7ba392',
  onPrimary: '#ffffff',
  fieldBorder: '#cbe8db',
  track: '#e2f2ea'
};

const EMERGENCY_CATEGORIES = new Set(['ambulance', 'police', 'fire']);

const DEFAULT_EMERGENCY = [
  { id: 'default-ambulance', name: 'Ambulance', phone: '108', category: 'ambulance' },
  { id: 'default-police', name: 'Police', phone: '100', category: 'police' },
  { id: 'default-fire', name: 'Fire', phone: '101', category: 'fire' }
];

const CATEGORY_META = {
  ambulance: { icon: 'medkit-outline', fill: '#fde8e4', glyph: '#c2503f' },
  police: { icon: 'shield-outline', fill: '#e4ecf7', glyph: '#5b7fb0' },
  fire: { icon: 'flame-outline', fill: '#f7e9d8', glyph: '#c78a4a' },
  custom: { icon: 'call-outline', fill: '#d3f6e3', glyph: '#059669' }
};

function ContactRow({ item, onCall, isLast }) {
  const meta = CATEGORY_META[item.category] || {
    icon: 'call-outline', fill: '#e2f2ea', glyph: ds.primary
  };

  return (
    <View>
      <View style={styles.row}>
        <View style={[styles.iconTile, { backgroundColor: meta.fill }]}>
          <Ionicons name={meta.icon} size={18} color={meta.glyph} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>{item.name}</Text>
          <Text style={styles.rowPhone}>{item.phone}</Text>
        </View>
        <TouchableOpacity
          style={styles.callBtn}
          onPress={() => onCall(item.phone)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={`Call ${item.name}`}
        >
          <Ionicons name="call" size={16} color={ds.primary} />
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

export default function DirectoryScreen({ navigation }) {
  const { activeMembership, activeBuildingId } = useAuth();
  const isGuard = activeMembership?.role === 'guard';
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

  const locationLabel = isGuard
    ? `${activeMembership?.buildingName || 'Your society'} · Gate`
    : (activeMembership?.buildingName || 'Your society');

  const topPad = isGuard
    ? 4
    : Platform.OS === 'android'
      ? (StatusBar.currentHeight || 12)
      : Platform.OS === 'web'
        ? 16
        : 8;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: topPad + 8 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.header, isGuard && styles.headerGuard]}>
          <View style={styles.headerLeft}>
            {!isGuard && <BrandLogo variant="icon-color" height={28} />}
            <View style={[styles.chip, isGuard && styles.chipGuard]}>
              <Ionicons name={isGuard ? 'shield-outline' : 'business-outline'} size={14} color={ds.primary} />
              <Text style={styles.chipText} numberOfLines={1}>{locationLabel}</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('Notifications')}
            style={[styles.bellBtn, isGuard && styles.bellBtnGuard]}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
          >
            <Ionicons name="notifications-outline" size={20} color={ds.heading} />
            {unreadCount > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.screenTitle}>{isGuard ? 'Directory' : 'Emergency'}</Text>
        <Text style={styles.screenSubtitle}>
          {isGuard ? 'Emergency and society contacts for the gate.' : 'Quick SOS and important contacts.'}
        </Text>

        <View style={styles.sosSection}>
          <View style={styles.sosGlowOuter}>
            <View style={styles.sosGlow}>
              <TouchableOpacity
                onPress={sos}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel="Send SOS"
              >
                <LinearGradient
                  colors={[ds.primaryLight, ds.primary]}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={styles.sosButton}
                >
                  <Text style={styles.sosText}>SOS</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.sosHeading}>Emergency help</Text>
          <Text style={styles.sosCaption}>Tap only in a real emergency.</Text>
        </View>

        <ContactSection title="Emergency services" items={emergency} onCall={call} />
        <ContactSection title="Society contacts" items={society} onCall={call} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 96
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16
  },
  headerGuard: {
    marginBottom: 14
  },
  headerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginRight: 12
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
    shadowColor: '#063c28',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2
  },
  chipGuard: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    color: ds.secondary
  },
  bellBtn: {
    padding: 4,
    position: 'relative'
  },
  bellBtnGuard: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: ds.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    shadowColor: '#063c28',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
  },
  bellBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: ds.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3
  },
  bellBadgeText: {
    color: ds.onPrimary,
    fontSize: 9,
    fontWeight: '700'
  },
  screenTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: ds.heading,
    letterSpacing: -0.5,
    marginBottom: 4
  },
  screenSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: ds.muted,
    marginBottom: 24,
    lineHeight: 18
  },
  sosSection: {
    alignItems: 'center',
    marginBottom: 32
  },
  sosGlowOuter: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: 'rgba(52, 211, 154, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18
  },
  sosGlow: {
    width: 148,
    height: 148,
    borderRadius: 74,
    backgroundColor: 'rgba(5, 150, 105, 0.16)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  sosButton: {
    width: 124,
    height: 124,
    borderRadius: 62,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#059669',
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8
  },
  sosText: {
    color: ds.onPrimary,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 2
  },
  sosHeading: {
    fontSize: 18,
    fontWeight: '800',
    color: ds.heading,
    marginBottom: 4
  },
  sosCaption: {
    fontSize: 13,
    fontWeight: '500',
    color: ds.muted
  },
  section: {
    marginBottom: 22
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: ds.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10
  },
  card: {
    backgroundColor: ds.surface,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#063c28',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
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
    fontSize: 14,
    fontWeight: '700',
    color: ds.heading
  },
  rowPhone: {
    fontSize: 13,
    fontWeight: '600',
    color: ds.primary,
    marginTop: 2
  },
  callBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: ds.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: ds.fieldBorder,
    shadowColor: '#063c28',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: ds.track,
    marginLeft: 66
  }
});
