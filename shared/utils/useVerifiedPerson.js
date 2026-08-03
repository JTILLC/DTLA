// src/utils/useVerifiedPerson.js
//
// Who is operating this device right now, proven once with a PIN.
//
// Asking for a PIN on every tap is what makes people share PINs — the fastest
// way to get a shift's work logged under one name is to make identifying
// yourself expensive. So it is asked once and remembered for a shift, and the
// name is shown constantly so it can be corrected the moment it is wrong.
//
// Device-scoped and IDLE-limited. The clock is reset by use, not by when the
// PIN was entered, and it is short: a tablet left on a bench for a quarter of
// an hour stops being anybody.
//
// Idle rather than absolute, because the two failure modes pull opposite ways.
// A fixed window long enough for a shift means whoever walks up next inherits
// the last person's name — the log stays plausible and is wrong, which is the
// worse failure. A fixed window short enough to be safe would interrupt someone
// mid-shift for no reason. Resetting on activity is safe when the tablet is put
// down and silent while it is in someone's hands.
import { useCallback, useEffect, useState } from 'react';

const EVENT = 'ccw-verified-person-changed';
// Long enough to cross a line and keep working; short enough that a tablet
// put down and picked up by someone else asks again.
const IDLE_MS = 15 * 60 * 1000;
const key = (customerId) => `ccw-verified-person:${customerId || 'none'}`;

const read = (customerId) => {
  try {
    const raw = localStorage.getItem(key(customerId));
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v?.name || !v?.at) return null;
    if (Date.now() - v.at > IDLE_MS) {
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

  // Called when the remembered identity is actually USED to attribute
  // something. Pushes the idle clock out, so continuous work never
  // re-prompts while an idle tablet still lapses.
  //
  // Storage only — deliberately no setState. This runs inside the same click
  // that is about to save, and re-rendering the tree mid-save would be a lot of
  // churn to record a timestamp nothing on screen displays.
  const touch = useCallback(() => {
    try {
      const raw = localStorage.getItem(key(customerId));
      if (!raw) return;
      const v = JSON.parse(raw);
      if (!v?.name) return;
      localStorage.setItem(key(customerId), JSON.stringify({ ...v, at: Date.now() }));
    } catch { /* a missed touch only means asking again sooner */ }
  }, [customerId]);

  return { person, remember, forget, touch };
}

export default { useVerifiedPerson };
