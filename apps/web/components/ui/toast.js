import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { IconAlert, IconCheck, IconX } from './icons';

// Minimal toast stack: toast.success(msg) / toast.error(msg). Every call shows
// a new toast, even when the text repeats.
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback((kind, message) => {
    const id = nextId.current++;
    setItems((list) => [...list.slice(-3), { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500);
  }, [dismiss]);

  const api = useRef({ success: (m) => push('success', m), error: (m) => push('error', m) });
  api.current.success = (m) => push('success', m);
  api.current.error = (m) => push('error', m);

  return (
    <ToastContext.Provider value={api.current}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end"
        aria-live="polite" role="status">
        {items.map((t) => (
          <div key={t.id}
            className={'pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-card backdrop-blur-xl ' +
              (t.kind === 'error' ? 'border-rose-400/25 bg-rose-950/70 text-rose-100' : 'border-emerald-400/25 bg-emerald-950/70 text-emerald-50')}>
            {t.kind === 'error' ? <IconAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" /> : <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />}
            <p className="flex-1 leading-snug">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} className="text-white/50 hover:text-white" aria-label="Dismiss">
              <IconX className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
