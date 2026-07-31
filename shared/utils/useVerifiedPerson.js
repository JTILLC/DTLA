// src/utils/useVerifiedPerson.js
//
// Who is operating this device right now, proven once with a PIN.
//
// Asking for a PIN on every tap is what makes people share PINs — the fastest
// way to get a shift's work logged under one name is to make identifying
// yourself expensive. So it is asked once and remembered for a shift, and the
// name is shown constantly so it can be corrected the moment it is wrong.
//
// Device-scoped and time-limited: it expires after 10 hours (longer than a
// shift, shorter than two) so an unattended tablet does not keep attributing
// work to whoever used it yesterday.
import { useCallback, useEffect, useState } from 'react';

const EVENT = 'ccw-verified-person-changed';
const TTL_MS = 10 * 60 * 60 * 1000;
const key = (customerId) => `ccw-verified-person:${customerId || 'none'}`;

const read = (customerId) => {
  try {
    const raw = localStorage.getItem(key(customerId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v?.name || !v?.at) return null;
    if (Date.now() - v.at > TTL_MS) {
      localStorage.removeItem(key(customerId));
      return null;
    }
    return v;                      // { id, name, at }
  } catch {
    return null;
  }
};

export function useVerifiedPerson(customerId) {
  const [person, setPerson] = useState(() => read(customerId));

  useEffect(() => { setPerson(read(customerId)); }, [customerId]);

  useEffect(() => {
    const onChange = (e) => {
      if (e.detail?.customerId === customerId) setPerson(read(customerId));
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [customerId]);

  const remember = useCallback((p) => {
    const v = { id: p.id, name: p.name, at: Date.now() };
    try { localStorage.setItem(key(customerId), JSON.stringify(v)); } catch { /* ignore */ }
    setPerson(v);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { customerId } }));
  }, [customerId]);

  const forget = useCallback(() => {
    try { localStorage.removeItem(key(customerId)); } catch { /* ignore */ }
    setPerson(null);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { customerId } }));
  }, [customerId]);

  return { person, remember, forget };
}

export default { useVerifiedPerson };
