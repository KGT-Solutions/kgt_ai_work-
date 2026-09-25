import React, { useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { AuthProvider } from './src/context/AuthContext';
import { AlertProvider } from './src/components/AppAlert';
import RootNavigator from './src/navigation/RootNavigator';
import { layout } from './src/theme';
import { ensureWebAppInstallHead } from './src/utils/webInstall';

/** Full-bleed canvas gradient (design-system.md) — not limited to content width */
const CANVAS = ['#effdf5', '#d3f6e3', '#eafaf1'];

function useWebDialogFrame() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const id = 'flatbriz-web-dialog-frame';
    if (document.getElementById(id)) return undefined;
    const style = document.createElement('style');
    style.id = id;
    const max = layout.desktopMaxWidth;
    style.textContent = `
      [role="dialog"], [aria-modal="true"] {
        max-width: ${max}px !important;
        left: 0 !important;
        right: 0 !important;
        margin-left: auto !important;
        margin-right: auto !important;
        width: 100% !important;
      }
    `;
    document.head.appendChild(style);
    return undefined;
  }, []);
}

function useHideWebScrollbars() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const id = 'flatbriz-hide-web-scrollbars';
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement('style');
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = [
      'html,body,*{scrollbar-width:none;-ms-overflow-style:none;}',
      'html::-webkit-scrollbar,body::-webkit-scrollbar,*::-webkit-scrollbar{display:none;width:0;height:0;}'
    ].join('');
    return undefined;
  }, []);
}

function useWebAppInstallHead() {
  useEffect(() => {
    ensureWebAppInstallHead();
  }, []);
}

export default function App() {
  useWebDialogFrame();
  useHideWebScrollbars();
  useWebAppInstallHead();
  return (
    <AlertProvider>
      <AuthProvider>
        <View style={styles.root}>
          <LinearGradient
            colors={CANVAS}
            locations={[0, 0.44, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.frame}>
            <StatusBar style="dark" />
            <RootNavigator />
          </View>
        </View>
      </AuthProvider>
    </AlertProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    ...(Platform.OS === 'web' ? { alignItems: 'center' } : null)
  },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: layout.desktopMaxWidth,
    backgroundColor: 'transparent',
    ...(Platform.OS === 'web'
      ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }
      : null)
  }
});
