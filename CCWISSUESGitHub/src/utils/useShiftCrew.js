// src/utils/useShiftCrew.js
//
// Who is working right now, remembered on this device.
//
// The plant signs in as one shared account, so the login says which customer,
// never which person. The crew is therefore a DEVICE setting, not an account
// one: the tablet at line 3 knows who is on line 3 this shift, and every log
// entry made from it is stamped with them.
//
// Kept per customer, because one JTI laptop moves between plants and must not
// carry Acme's operator into Beta's log.
//
// Shared across components through a window event rather than a context
// provider: the bar and the log pages are mounted in different subtrees in two
// different apps, and threading a provider through both App.jsx files is a lot
// of surgery for three strings.
import { useCallback, useEffect, useState } from 'react';

const EVENT = 'ccw-shift-crew-changed';
const key = (customerId) => `ccw-shift-crew:${customerId || 'none'}`;

const EMPTY = { operator: '', tech: '', supervisor: '' };

const read = (customerId) => {
  try {
    const raw = localStorage.getItem(key(customerId));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed };
  } catch {
    return EMPTY;                 // storage unavailable or corrupt — start clean
  }
};

export function useShiftCrew(customerId) {
  const [crew, setCrew] = useState(() => read(customerId));

  useEffect(() => { setCrew(read(customerId)); }, [customerId]);

  useEffect(() => {
    const onChange = (e) => {
      if (e.detail?.customerId === customerId) setCrew(read(customerId));
    };
    window.addEventListener(EVENT, onChange);
    // Another tab on the same tablet counts as the same shift.
    const onStorage = (e) => { if (e.key === key(customerId)) setCrew(read(customerId)); };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [customerId]);

  const setRole = useCallback((role, name) => {
    const next = { ...read(customerId), [role]: name };
    try { localStorage.setItem(key(customerId), JSON.stringify(next)); } catch { /* ignore */ }
    setCrew(next);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { customerId } }));
  }, [customerId]);

  const clear = useCallback(() => {
    try { localStorage.removeItem(key(customerId)); } catch { /* ignore */ }
    setCrew(EMPTY);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { customerId } }));
  }, [customerId]);

  return { crew, setRole, clear };
}

// The fields every log entry carries. shiftId is reserved: entries are stamped
// with names now, and grouping them into shift records later must not require
// rewriting anything already logged.
export const crewStamp = (crew) => ({
  operator: crew?.operator || '',
  tech: crew?.tech || '',
  supervisor: crew?.supervisor || '',
  shiftId: null,
});

export default { useShiftCrew, crewStamp };
