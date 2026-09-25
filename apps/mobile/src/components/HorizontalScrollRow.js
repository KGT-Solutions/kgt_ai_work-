import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius } from '../theme';

const SCROLL_STEP = 120;
const SCROLL_STYLE_ID = 'flatbriz-hide-h-scroll';

export default function HorizontalScrollRow({
  label,
  labelStyle,
  children,
  scrollNativeId,
  scrollStep = SCROLL_STEP,
  contentContainerStyle,
  style
}) {
  const scrollRef = useRef(null);
  const metrics = useRef({ scrollX: 0, contentWidth: 0, layoutWidth: 0 });
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    if (document.getElementById(SCROLL_STYLE_ID)) return undefined;
    const styleEl = document.createElement('style');
    styleEl.id = SCROLL_STYLE_ID;
    styleEl.textContent = [
      '#vendor-date-scroll::-webkit-scrollbar',
      '#facility-date-scroll::-webkit-scrollbar',
      '#facility-chip-scroll::-webkit-scrollbar'
    ].join(',') + '{display:none;width:0;height:0;}';
    document.head.appendChild(styleEl);
    return undefined;
  }, []);

  const updateScrollButtons = useCallback(() => {
    const { scrollX, contentWidth, layoutWidth } = metrics.current;
    const maxScroll = Math.max(0, contentWidth - layoutWidth);
    setCanScrollLeft(scrollX > 4);
    setCanScrollRight(scrollX < maxScroll - 4);
  }, []);

  const scrollBy = (delta) => {
    const { scrollX, contentWidth, layoutWidth } = metrics.current;
    const maxScroll = Math.max(0, contentWidth - layoutWidth);
    const next = Math.max(0, Math.min(maxScroll, scrollX + delta));
    scrollRef.current?.scrollTo({ x: next, animated: true });
    metrics.current.scrollX = next;
    updateScrollButtons();
  };

  const onScroll = (e) => {
    metrics.current.scrollX = e.nativeEvent.contentOffset.x;
    updateScrollButtons();
  };

  const onContentSizeChange = (w) => {
    metrics.current.contentWidth = w;
    updateScrollButtons();
  };

  const onLayout = (e) => {
    metrics.current.layoutWidth = e.nativeEvent.layout.width;
    updateScrollButtons();
  };

  return (
    <View style={[styles.wrap, style]}>
      {label ? (
        <View style={styles.header}>
          <Text style={[styles.label, labelStyle, styles.labelInHeader]}>{label}</Text>
          <View style={styles.controls}>
            <TouchableOpacity
              onPress={() => scrollBy(-scrollStep)}
              disabled={!canScrollLeft}
              style={[styles.arrowBtn, !canScrollLeft && styles.arrowBtnDisabled]}
              activeOpacity={0.75}
              accessibilityLabel="Scroll left"
            >
              <Ionicons name="chevron-back" size={16} color={canScrollLeft ? colors.primary : colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => scrollBy(scrollStep)}
              disabled={!canScrollRight}
              style={[styles.arrowBtn, !canScrollRight && styles.arrowBtnDisabled]}
              activeOpacity={0.75}
              accessibilityLabel="Scroll right"
            >
              <Ionicons name="chevron-forward" size={16} color={canScrollRight ? colors.primary : colors.textMuted} />
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.controlsOnly}>
          <TouchableOpacity
            onPress={() => scrollBy(-scrollStep)}
            disabled={!canScrollLeft}
            style={[styles.arrowBtn, !canScrollLeft && styles.arrowBtnDisabled]}
            activeOpacity={0.75}
            accessibilityLabel="Scroll left"
          >
            <Ionicons name="chevron-back" size={16} color={canScrollLeft ? colors.primary : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => scrollBy(scrollStep)}
            disabled={!canScrollRight}
            style={[styles.arrowBtn, !canScrollRight && styles.arrowBtnDisabled]}
            activeOpacity={0.75}
            accessibilityLabel="Scroll right"
          >
            <Ionicons name="chevron-forward" size={16} color={canScrollRight ? colors.primary : colors.textMuted} />
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator={false}
        nativeID={scrollNativeId}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onContentSizeChange}
        onLayout={onLayout}
        style={[styles.row, Platform.OS === 'web' && styles.rowWeb]}
        contentContainerStyle={[styles.rowContent, contentContainerStyle]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm
  },
  controlsOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginBottom: spacing.sm
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    flex: 1
  },
  labelInHeader: { marginBottom: 0 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  arrowBtn: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center'
  },
  arrowBtnDisabled: { opacity: 0.45 },
  row: { flexGrow: 0 },
  rowWeb: { overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' },
  rowContent: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.sm }
});
