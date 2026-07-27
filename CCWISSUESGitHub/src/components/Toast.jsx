import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const ToastContext = createContext(null);

const ICONS = {
  success: (
    <svg className="toast-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" />
    </svg>
  ),
  error: (
    <svg className="toast-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M18 10A8 8 0 11 2 10a8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" />
    </svg>
  ),
  info: (
    <svg className="toast-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" />
    </svg>
  ),
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message, options = {}) => {
    const type = options.type || 'info';
    const duration = options.duration ?? (type === 'error' ? 5000 : 3000);
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  const api = useMemo(() => ({
    show,
    success: (msg, opts) => show(msg, { ...opts, type: 'success' }),
    error: (msg, opts) => show(msg, { ...opts, type: 'error' }),
    info: (msg, opts) => show(msg, { ...opts, type: 'info' }),
    dismiss,
  }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`jti-toast jti-toast-${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
            {ICONS[t.type]}
            <div className="toast-body-text">{t.message}</div>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.293 6.293a1 1 0 011.414 0L10 8.586l2.293-2.293a1 1 0 111.414 1.414L11.414 10l2.293 2.293a1 1 0 01-1.414 1.414L10 11.414l-2.293 2.293a1 1 0 01-1.414-1.414L8.586 10 6.293 7.707a1 1 0 010-1.414z" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      show: (msg) => window.alert(msg),
      success: (msg) => window.alert(msg),
      error: (msg) => window.alert(msg),
      info: (msg) => window.alert(msg),
      dismiss: () => {},
    };
  }
  return ctx;
}

/**
 * Patch window.alert so existing ~74 alert() call sites render as toasts.
 */
export function AlertShim() {
  const toast = useToast();
  const mountedRef = useRef(false);
  if (!mountedRef.current && typeof window !== 'undefined') {
    mountedRef.current = true;
    const original = window.alert;
    window.alert = (msg) => {
      const text = String(msg ?? '');
      const lower = text.toLowerCase();
      if (/fail|error|invalid|missing|no data|please select|no visit|cannot|unable/i.test(lower)) {
        toast.error(text);
      } else if (/saved|loaded|imported|updated|renamed|deleted|copied|duplicated|restored|attached|synced/i.test(lower)) {
        toast.success(text);
      } else {
        toast.info(text);
      }
    };
    window.__originalAlert = original;
  }
  return null;
}
