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
//
// One person is never asked: a JTI super admin, who is not on the plant's crew
// list and has no PIN to type. They are the standing identity on this device
// until somebody keys a PIN over the top, and dropping that PIN returns to
// them rather than to nobody. See superUser.js.
import { useCallback, useEffect, useState } from 'react';
import { useSuperUser } from './superUser.js';

const EVENT = 'ccw-verified-person-changed';
// Long enough to cross a line and keep working; short enough that a tablet put
// down and picked up by someone else asks again. Five minutes of INACTIVITY —
// the clock is reset by the person actually using the device, so it never
// interrupts somebody mid-job and never survives them walking away.
const IDLE_MS = 5 * 60 * 1000;

// Don't write to storage on every keystroke; once every few seconds keeps the
// clock honest without the churn.
const TOUCH_THROTTLE_MS = 5000;
// How often to notice that the session has lapsed. The badge saying "Logging as
// X" when X expired four minutes ago is worse than no badge at all.
const EXPIRY_TICK_MS = 10000;
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
  // Whoever proved themselves with a PIN on THIS device, if anyone. Kept
  // separate from the returned identity below, because everything about the
  // idle clock — the listeners, the expiry tick, the storage — is about a PIN
  // session, and a JTI account has none of that.
  const [stored, setStored] = useState(() => read(customerId));
  const superUser = useSuperUser();
  // A keyed-in PIN wins over the JTI account, so a JTI engineer can still hand
  // the tablet to a fitter and have the work land under the fitter's name.
  const person = stored || superUser;

  useEffect(() => { setStored(read(customerId)); }, [customerId]);

  useEffect(() => {
    const onChange = (e) => {
      if (e.detail?.customerId === customerId) setStored(read(customerId));
    };
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, [customerId]);

  const remember = useCallback((p) => {
    // The JTI identity comes from the signed-in account and outlives any idle
    // window, so writing it to storage would only leave a copy to go stale.
    if (p?.isSuper) return;
    const v = { id: p.id, name: p.name, at: Date.now() };
    try { localStorage.setItem(key(customerId), JSON.stringify(v)); } catch { /* ignore */ }
    setStored(v);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { customerId } }));
  }, [customerId]);

  const forget = useCallback(() => {
    try { localStorage.removeItem(key(customerId)); } catch { /* ignore */ }
    setStored(null);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { customerId } }));
  }, [customerId]);

  // Called when the remembered identity is actually USED to attribute
  // something, and by the activity listener below. Pushes the idle clock out,
  // so continuous work never re-prompts while an idle tablet still lapses.
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

  // INACTIVITY means inactivity.
  //
  // The clock used to move only when the identity was USED to save something,
  // which was survivable at fifteen minutes and would be maddening at five: a
  // fitter typing a note for six minutes would be asked to prove who they are
  // again before they could file it. Real input counts.
  //
  // Only while somebody is signed in — no listeners on a device nobody has
  // identified themselves on.
  useEffect(() => {
    if (!stored) return undefined;
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last < TOUCH_THROTTLE_MS) return;
      last = now;
      touch();
    };
    const events = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, [stored, touch]);

  // Notice the lapse rather than waiting for the next render to happen by
  // chance, so the header stops naming somebody who has gone.
  useEffect(() => {
    if (!stored) return undefined;
    const id = setInterval(() => {
      if (!read(customerId)) {
        setStored(null);
        window.dispatchEvent(new CustomEvent(EVENT, { detail: { customerId } }));
      }
    }, EXPIRY_TICK_MS);
    return () => clearInterval(id);
  }, [stored, customerId]);

  return { person, remember, forget, touch };
}

export default { useVerifiedPerson };
