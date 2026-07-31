// src/utils/useHeadAlerts.js
//
// Tell someone when a head stops.
//
// Everything else in these apps is pull — somebody has to open the screen. A
// head going offline stops product, and it is the one event worth pushing.
//
// What this does and does not do
// ------------------------------
// It raises a browser notification while the app is OPEN (including in a
// background tab, which is the realistic case: a supervisor's laptop with the
// board left up). It cannot reach a closed app or a locked phone — that needs
// push subscriptions and a server to send them, which is a different piece of
// work and should not be implied by a switch that quietly does less.
//
// The UI says exactly that, because a supervisor who believes they will be told
// and is not is worse off than one who knows to check.
import { useEffect, useRef, useState } from 'react';

const PREF_KEY = 'ccw-head-alerts';

export const alertsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export const alertsEnabled = () => {
  if (!alertsSupported()) return false;
  try { return localStorage.getItem(PREF_KEY) === 'on' && Notification.permission === 'granted'; }
  catch { return false; }
};

export async function enableAlerts() {
  if (!alertsSupported()) return false;
  const res = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (res !== 'granted') return false;
  try { localStorage.setItem(PREF_KEY, 'on'); } catch { /* ignore */ }
  return true;
}

export function disableAlerts() {
  try { localStorage.setItem(PREF_KEY, 'off'); } catch { /* ignore */ }
}

// Watches a head event log and notifies on new offline events.
//
// The first snapshot is ignored deliberately: subscribing must not fire a
// notification for every head that was already off before the page opened.
export function useHeadAlerts(headLog, { customerName } = {}) {
  const seeded = useRef(false);
  const seen = useRef(new Set());
  const [lastAlert, setLastAlert] = useState(null);

  useEffect(() => {
    if (!Array.isArray(headLog) || headLog.length === 0) return;

    if (!seeded.current) {
      headLog.forEach((e) => seen.current.add(e.id));
      seeded.current = true;
      return;
    }

    const fresh = headLog.filter((e) => !seen.current.has(e.id));
    fresh.forEach((e) => seen.current.add(e.id));

    const stops = fresh.filter((e) => e.action === 'offline');
    if (stops.length === 0) return;

    setLastAlert(stops[0]);
    if (!alertsEnabled()) return;

    stops.slice(0, 3).forEach((e) => {
      try {
        // eslint-disable-next-line no-new
        new Notification(`Head ${e.headNumber} offline — ${e.lineTitle}`, {
          body: [customerName, e.by && `by ${e.by}`].filter(Boolean).join(' · '),
          tag: `head-${e.lineTitle}-${e.headNumber}`,   // one per head, not a pile
        });
      } catch (err) {
        console.warn('notification failed:', err?.message || err);
      }
    });
  }, [headLog, customerName]);

  return { lastAlert };
}

export default { useHeadAlerts, enableAlerts, disableAlerts, alertsEnabled, alertsSupported };
