import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { listingIconMeta } from '../data/dummyMarketplace';

/** Tokens from design-system.md (Emerald Fresh) */
const ds = {
  surface: '#ffffff',
  primary: '#059669',
  heading: '#06231a',
  muted: '#7ba392',
  onPrimary: '#ffffff'
};

export default function MarketplaceListingCard({ item, onPress, style }) {
  const meta = item.icon
    ? { icon: item.icon, tint: item.tint, color: item.color }
    : listingIconMeta(item.type);

  const showNew = Boolean(item.isNew || item.badge === 'NEW');

  const content = (
    <>
      <View style={styles.media}>
        {item.image ? (
          <Image source={item.image} style={styles.photo} resizeMode="cover" />
        ) : (
          <View style={[styles.image, { backgroundColor: meta.tint || '#d3f6e3' }]}>
            <Ionicons name={meta.icon} size={36} color={meta.color || ds.primary} />
          </View>
        )}
        {showNew ? (
          <View style={styles.newBadge}>
            <Text style={styles.newBadgeText}>NEW</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        {item.price != null && (
          <Text style={styles.price}>₹ {Number(item.price).toLocaleString('en-IN')}</Text>
        )}
        {item.flatLabel ? (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={12} color={ds.muted} />
            <Text style={styles.metaText} numberOfLines={1}>{item.flatLabel}</Text>
          </View>
        ) : null}
      </View>
    </>
  );

  if (onPress) {
    return (
      <TouchableOpacity style={[styles.card, style]} onPress={onPress} activeOpacity={0.88}>
        {content}
      </TouchableOpacity>
    );
  }

  return <View style={[styles.card, style]}>{content}</View>;
}

const styles = StyleSheet.create({
  card: {
    width: '48%',
    backgroundColor: ds.surface,
    borderRadius: 18,
    overflow: 'hidden',
    shadowColor: '#063c28',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2
  },
  media: {
    position: 'relative',
    overflow: 'hidden'
  },
  image: {
    height: 110,
    alignItems: 'center',
    justifyContent: 'center'
  },
  photo: {
    width: '100%',
    height: 110,
    backgroundColor: '#e2f2ea'
  },
  newBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#c78a4a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8
  },
  newBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: ds.onPrimary,
    letterSpacing: 0.3
  },
  body: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: ds.heading,
    marginBottom: 4
  },
  price: {
    fontSize: 13,
    fontWeight: '800',
    color: ds.primary,
    marginBottom: 6
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  metaText: {
    flex: 1,
    fontSize: 11,
    fontWeight: '500',
    color: ds.muted
  }
});
