import { Platform } from 'react-native';

export function isWebRuntime() {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

function ensureHeadNode(selector, create) {
  if (typeof document === 'undefined') return;
  if (document.head.querySelector(selector)) return;
  document.head.appendChild(create());
}

/** Fallback if Expo serves the default HTML template instead of public/index.html. */
export function ensureWebAppInstallHead() {
  if (!isWebRuntime() || typeof document === 'undefined') return;

  ensureHeadNode('link[rel="manifest"]', () => {
    const el = document.createElement('link');
    el.rel = 'manifest';
    el.href = '/manifest.json';
    return el;
  });
  ensureHeadNode('meta[name="theme-color"]', () => {
    const el = document.createElement('meta');
    el.name = 'theme-color';
    el.content = '#059669';
    return el;
  });
  ensureHeadNode('link[rel="apple-touch-icon"]', () => {
    const el = document.createElement('link');
    el.rel = 'apple-touch-icon';
    el.href = '/apple-touch-icon.png';
    return el;
  });
  ensureHeadNode('meta[name="apple-mobile-web-app-capable"]', () => {
    const el = document.createElement('meta');
    el.name = 'apple-mobile-web-app-capable';
    el.content = 'yes';
    return el;
  });
  ensureHeadNode('meta[name="mobile-web-app-capable"]', () => {
    const el = document.createElement('meta');
    el.name = 'mobile-web-app-capable';
    el.content = 'yes';
    return el;
  });
  ensureHeadNode('meta[name="apple-mobile-web-app-title"]', () => {
    const el = document.createElement('meta');
    el.name = 'apple-mobile-web-app-title';
    el.content = 'FLATBRIZ';
    return el;
  });
  ensureHeadNode('meta[name="apple-mobile-web-app-status-bar-style"]', () => {
    const el = document.createElement('meta');
    el.name = 'apple-mobile-web-app-status-bar-style';
    el.content = 'default';
    return el;
  });
}
