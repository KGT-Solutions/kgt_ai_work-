import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { colors, radius, font } from '../lib/theme';

const AlertContext = createContext(null);

/** Imperative handle so non-React code / simple catch blocks can show alerts */
let imperativeShow = null;

/**
 * Show a centered themed popup.
 * @param {{ type?: 'error'|'success'|'info'|'confirm', title?: string, message: string, confirmLabel?: string, cancelLabel?: string, onConfirm?: () => void }} opts
 * @returns {Promise<boolean>} resolves true if confirmed / OK pressed
 */
export function showAlert(opts) {
  if (!imperativeShow) {
    if (typeof window !== 'undefined' && opts?.message) {
      window.alert([opts.title, opts.message].filter(Boolean).join('\n\n'));
    }
    return Promise.resolve(false);
  }
  return imperativeShow(opts);
}

export function showError(message, title = 'Something went wrong') {
  return showAlert({ type: 'error', title, message: String(message || 'An unexpected error occurred.') });
}

export function showSuccess(message, title = 'Success') {
  return showAlert({ type: 'success', title, message: String(message || 'Done.') });
}

export function showInfo(message, title = 'Notice') {
  return showAlert({ type: 'info', title, message: String(message || '') });
}

export function showConfirm(message, { title = 'Please confirm', confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = {}) {
  return showAlert({
    type: 'confirm',
    title,
    message: String(message || ''),
    confirmLabel,
    cancelLabel
  });
}

const TYPE_META = {
  error: { accent: colors.error, soft: '#FCECEA', icon: '!' },
  success: { accent: colors.accent, soft: colors.accentSoft, icon: '✓' },
  info: { accent: colors.primary, soft: '#EEF1F4', icon: 'i' },
  confirm: { accent: colors.warning, soft: '#FDF6EC', icon: '?' }
};

export function AlertProvider({ children }) {
  const [queue, setQueue] = useState([]);
  const current = queue[0] || null;

  const dismiss = useCallback((result) => {
    setQueue((prev) => {
      const [head, ...rest] = prev;
      if (head?.resolve) head.resolve(result);
      return rest;
    });
  }, []);

  const show = useCallback((opts) => {
    const message = opts?.message != null ? String(opts.message) : '';
    if (!message && opts?.type !== 'confirm') {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      setQueue((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: opts.type || 'info',
          title: opts.title || defaultTitle(opts.type || 'info'),
          message,
          confirmLabel: opts.confirmLabel || (opts.type === 'confirm' ? 'Confirm' : 'OK'),
          cancelLabel: opts.cancelLabel || 'Cancel',
          resolve
        }
      ]);
    });
  }, []);

  useEffect(() => {
    imperativeShow = show;
    return () => {
      if (imperativeShow === show) imperativeShow = null;
    };
  }, [show]);

  const value = useMemo(() => ({ show, showError, showSuccess, showInfo, showConfirm }), [show]);

  const meta = current ? (TYPE_META[current.type] || TYPE_META.info) : null;

  return (
    <AlertContext.Provider value={value}>
      {children}
      {current && meta && (
        <div
          className="admin-alert-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="admin-alert-title"
          aria-describedby="admin-alert-message"
          onClick={() => {
            if (current.type !== 'confirm') dismiss(true);
          }}
        >
          <div
            className="admin-alert-panel"
            style={{ ...panelStyle, borderTop: `4px solid ${meta.accent}` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ ...iconWrap, background: meta.soft, color: meta.accent }}>
              <span style={iconGlyph}>{meta.icon}</span>
            </div>
            <h2 id="admin-alert-title" style={titleStyle}>{current.title}</h2>
            <p id="admin-alert-message" style={messageStyle}>{current.message}</p>
            <div style={actions}>
              {current.type === 'confirm' && (
                <button
                  type="button"
                  style={btnSecondary}
                  onClick={() => dismiss(false)}
                >
                  {current.cancelLabel}
                </button>
              )}
              <button
                type="button"
                style={{
                  ...btnPrimary,
                  background: current.type === 'error' ? colors.error : current.type === 'confirm' ? colors.warning : colors.accent
                }}
                onClick={() => {
                  if (current.type === 'confirm') dismiss(true);
                  else dismiss(true);
                }}
                autoFocus
              >
                {current.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </AlertContext.Provider>
  );
}

function defaultTitle(type) {
  if (type === 'error') return 'Something went wrong';
  if (type === 'success') return 'Success';
  if (type === 'confirm') return 'Please confirm';
  return 'Notice';
}

export function useAlert() {
  const ctx = useContext(AlertContext);
  if (!ctx) {
    return {
      show: showAlert,
      showError,
      showSuccess,
      showInfo,
      showConfirm
    };
  }
  return ctx;
}

const panelStyle = {
  background: colors.card,
  borderRadius: radius.lg,
  width: '100%',
  maxWidth: 400,
  padding: '28px 24px 22px',
  boxShadow: '0 24px 60px rgba(43, 58, 74, 0.22)',
  textAlign: 'center',
  fontFamily: font
};

const iconWrap = {
  width: 52,
  height: 52,
  borderRadius: radius.pill,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto 16px'
};

const iconGlyph = { fontSize: 22, fontWeight: 700, lineHeight: 1 };

const titleStyle = {
  margin: '0 0 8px',
  fontSize: 18,
  fontWeight: 700,
  color: colors.primary,
  fontFamily: font
};

const messageStyle = {
  margin: '0 0 22px',
  fontSize: 14,
  lineHeight: 1.5,
  color: colors.textMuted,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word'
};

const actions = {
  display: 'flex',
  gap: 10,
  justifyContent: 'center',
  flexWrap: 'wrap'
};

const btnPrimary = {
  padding: '11px 22px',
  borderRadius: radius.sm,
  border: 'none',
  color: '#fff',
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: font,
  minWidth: 100
};

const btnSecondary = {
  padding: '11px 22px',
  borderRadius: radius.sm,
  border: `1px solid ${colors.border}`,
  background: colors.background,
  color: colors.primary,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: font,
  minWidth: 100
};
