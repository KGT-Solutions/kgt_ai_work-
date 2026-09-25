import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet, Platform
} from 'react-native';
import { colors, spacing, radius, shadow } from '../theme';

const AlertContext = createContext(null);

let imperativeShow = null;

/**
 * Themed centered popup — replaces native Alert / window.alert on web.
 * @returns {Promise<boolean>}
 */
export function showAlert(title, message, buttons, typeOverride) {
  const text = message != null ? String(message) : '';
  const heading = title != null ? String(title) : 'Notice';

  // Infer type from title keywords when called like Alert.alert
  const lower = heading.toLowerCase();
  let type = typeOverride || 'info';
  if (!typeOverride) {
    if (/error|fail|could not|invalid|missing|denied|booking failed/.test(lower)) type = 'error';
    else if (/success|added|updated|saved|sent|done|welcome|login|requested|booked/.test(lower)) type = 'success';
    else if (buttons?.some((b) => b.style === 'cancel') || buttons?.length > 1) type = 'confirm';
  }

  if (!imperativeShow) {
    // Provider not mounted yet — fall back
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert([heading, text].filter(Boolean).join('\n\n'));
      const action = buttons?.find((b) => b.style !== 'cancel')?.onPress;
      action?.();
      return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  return imperativeShow({
    type,
    title: heading,
    message: text,
    buttons
  });
}

export function showError(message, title = 'Something went wrong') {
  return showAlert(title, message, undefined, 'error');
}

export function showSuccess(message, title = 'Success') {
  return showAlert(title, message, undefined, 'success');
}

const TYPE_META = {
  error: { accent: colors.error, soft: '#fcecea', icon: '!' },
  success: { accent: colors.primary, soft: colors.accentSoft, icon: '✓' },
  info: { accent: colors.primary, soft: colors.accentSoft, icon: 'i' },
  confirm: { accent: colors.warning, soft: colors.warningSoft, icon: '?' }
};

export function AlertProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const current = queue[0] || null;

  const dismiss = useCallback((result, button) => {
    setQueue((prev) => {
      const [head, ...rest] = prev;
      if (head) {
        button?.onPress?.();
        head.resolve?.(result);
      }
      return rest;
    });
  }, []);

  const show = useCallback((opts) => new Promise((resolve) => {
    setQueue((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: opts.type || 'info',
        title: opts.title || 'Notice',
        message: opts.message || '',
        buttons: opts.buttons,
        resolve
      }
    ]);
  }), []);

  useEffect(() => {
    imperativeShow = show;
    return () => {
      if (imperativeShow === show) imperativeShow = null;
    };
  }, [show]);

  const value = useMemo(() => ({ show, showAlert, showError, showSuccess }), [show]);
  const meta = current ? (TYPE_META[current.type] || TYPE_META.info) : null;

  const actions = current?.buttons?.length
    ? current.buttons
    : [{ text: 'OK', onPress: undefined }];

  return (
    <AlertContext.Provider value={value}>
      {children}
      <Modal
        visible={!!current}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (current?.type === 'confirm') {
            const cancel = actions.find((b) => b.style === 'cancel');
            dismiss(false, cancel);
          } else {
            dismiss(true, actions[0]);
          }
        }}
      >
        <View style={styles.backdrop}>
          {current && meta && (
            <View style={[styles.panel, shadow.card, { borderTopColor: meta.accent }]}>
              <View style={[styles.iconWrap, { backgroundColor: meta.soft }]}>
                <Text style={[styles.icon, { color: meta.accent }]}>{meta.icon}</Text>
              </View>
              <Text style={styles.title}>{current.title}</Text>
              {!!current.message && <Text style={styles.message}>{current.message}</Text>}
              <View style={styles.actions}>
                {actions.map((btn, idx) => {
                  const isCancel = btn.style === 'cancel';
                  const isDestructive = btn.style === 'destructive';
                  const isPrimary = !isCancel && (actions.length === 1 || idx === actions.length - 1);
                  return (
                    <TouchableOpacity
                      key={`${btn.text}-${idx}`}
                      style={[
                        styles.btn,
                        isCancel && styles.btnCancel,
                        isPrimary && !isDestructive && { backgroundColor: meta.accent },
                        isDestructive && { backgroundColor: colors.error }
                      ]}
                      onPress={() => dismiss(!isCancel, btn)}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[
                          styles.btnText,
                          isCancel && styles.btnTextCancel,
                          (isPrimary || isDestructive) && styles.btnTextPrimary
                        ]}
                      >
                        {btn.text || 'OK'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}
        </View>
      </Modal>
    </AlertContext.Provider>
  );
}

export function useAppAlert() {
  return useContext(AlertContext) || { showAlert, showError, showSuccess };
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(6, 35, 26, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg
  },
  panel: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderTopWidth: 4,
    alignItems: 'center'
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md
  },
  icon: { fontSize: 22, fontWeight: '800' },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.primaryInk,
    textAlign: 'center',
    marginBottom: spacing.sm,
    letterSpacing: -0.3
  },
  message: {
    fontSize: 14,
    color: colors.textBody,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: spacing.lg
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    width: '100%'
  },
  btn: {
    minWidth: 100,
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center'
  },
  btnCancel: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border
  },
  btnText: { fontSize: 14, fontWeight: '700', color: colors.primaryInk },
  btnTextCancel: { color: colors.textBody },
  btnTextPrimary: { color: '#fff' }
});
