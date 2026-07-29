import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

// Lightweight toast system replacing blocking alert() popups.
// Usage: const toast = useToast(); toast.success('Saved'); toast.error('Failed');
const ToastContext = createContext(null);

const ICONS = {
  success: (
    <svg className="w-5 h-5 shrink-0 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="m9 12 2 2 4-4" />
    </svg>
  ),
  error: (
    <svg className="w-5 h-5 shrink-0 text-red-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="m15 9-6 6M9 9l6 6" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5 shrink-0 text-indigo-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4M12 8h.01" />
    </svg>
  )
};

const BORDERS = {
  success: 'border-l-emerald-500',
  error: 'border-l-red-500',
  info: 'border-l-indigo-500'
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type, message, duration) => {
    const id = ++idRef.current;
    // Errors stick around longer so they can be read on the plant floor
    const ttl = duration ?? (type === 'error' ? 6000 : 3500);
    setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
    setTimeout(() => dismiss(id), ttl);
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (msg, ms) => push('success', msg, ms),
    error: (msg, ms) => push('error', msg, ms),
    info: (msg, ms) => push('info', msg, ms)
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Stack sits above the mobile bottom nav (z-40) and modals (z-50) */}
      <div className="fixed top-3 right-3 z-[1200] flex flex-col gap-2 max-w-[calc(100vw-24px)] pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 min-w-[230px] max-w-sm px-3.5 py-3 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 border-l-4 ${BORDERS[t.type]} shadow-lg text-sm text-gray-800 dark:text-gray-100 animate-toast-in`}
          >
            {ICONS[t.type]}
            <span className="leading-snug break-words min-w-0 pt-0.5">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-auto -mr-1 p-1 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              aria-label="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
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
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
