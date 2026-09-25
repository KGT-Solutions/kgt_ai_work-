import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { colors } from '../theme';

const SOURCES = {
  'icon-color': require('../../assets/brand/icon-color-transparent.png'),
  'icon-white': require('../../assets/brand/icon-white.png'),
  'wordmark-color': require('../../assets/brand/wordmark-color.png'),
  'wordmark-white': require('../../assets/brand/wordmark-white.png')
};

/** Cropped wordmark aspect (~3293×1154). */
const WORDMARK_ASPECT = 2.85;

/**
 * FLATBRIZ brand mark. On load failure, shows text fallback "FLATBRIZ".
 * Color wordmark uses a white-bg-stripped PNG so it sits on the canvas cleanly.
 * @param {'icon-color'|'icon-white'|'wordmark-color'|'wordmark-white'} variant
 */
export default function BrandLogo({
  variant = 'wordmark-color',
  height = 36,
  style,
  fallbackColor
}) {
  const [failed, setFailed] = useState(false);
  const isWordmark = variant.startsWith('wordmark');
  const isWhite = variant.endsWith('white');
  const width = isWordmark ? Math.round(height * WORDMARK_ASPECT) : Math.round(height * 0.76);
  const color = fallbackColor || (isWhite ? '#ffffff' : colors.primary);

  if (failed) {
    return (
      <Text
        style={[styles.fallback, { color, fontSize: Math.max(14, height * 0.45) }, style]}
        accessibilityRole="header"
      >
        FLATBRIZ
      </Text>
    );
  }

  return (
    <View style={[styles.box, { height, width }, style]}>
      <Image
        source={SOURCES[variant] || SOURCES['wordmark-color']}
        style={styles.image}
        resizeMode="contain"
        accessibilityLabel="FLATBRIZ"
        onError={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  image: {
    width: '100%',
    height: '100%'
  },
  fallback: {
    fontWeight: '800',
    letterSpacing: 0.6,
    alignSelf: 'flex-start'
  }
});
