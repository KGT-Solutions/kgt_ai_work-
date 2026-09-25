import React from 'react';
import { View, StyleSheet } from 'react-native';
import GuardBrandHeader from '../components/GuardBrandHeader';

/** Wraps a screen with the floating FLATBRIZ guard brand header. */
export default function withGuardBrand(Screen) {
  function GuardBrandedScreen(props) {
    return (
      <View style={styles.root}>
        <GuardBrandHeader />
        <View style={styles.body}>
          <Screen {...props} />
        </View>
      </View>
    );
  }
  GuardBrandedScreen.displayName = `withGuardBrand(${Screen.displayName || Screen.name || 'Screen'})`;
  return GuardBrandedScreen;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  body: { flex: 1, backgroundColor: 'transparent' }
});
