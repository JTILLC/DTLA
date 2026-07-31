// src/utils/useLineCrew.js
//
// Who is crewed on a line right now, and the fields every log entry carries.
//
// Names are COPIED onto an entry when it is saved, never referenced. Crews
// change every shift; a log has to keep saying who did the work, not who is on
// the line today.
import { useEffect, useState } from 'react';
import { subscribeLineCrew } from '../services/logs.js';

const EMPTY = { operator: '', tech: '', supervisor: '' };

export function useLineCrew(workspaceId, customerId) {
  const [doc, setDoc] = useState({ lines: {} });

  useEffect(() => {
    if (!workspaceId || !customerId) { setDoc({ lines: {} }); return undefined; }
    return subscribeLineCrew(workspaceId, customerId, setDoc);
  }, [workspaceId, customerId]);

  return {
    lines: doc.lines || {},
    updatedAt: doc.updatedAt || null,
    forLine: (title) => ({ ...EMPTY, ...((doc.lines || {})[title] || {}) }),
  };
}

// shiftId is reserved: entries are stamped with names now, and grouping them
// into shift records later must not require rewriting anything already logged.
export const crewStamp = (crew) => ({
  operator: crew?.operator || '',
  tech: crew?.tech || '',
  supervisor: crew?.supervisor || '',
  shiftId: null,
});

// A crew set two days ago is probably last shift's. Say so rather than stamping
// stale names onto today's work in silence.
export function crewAge(updatedAt) {
  if (!updatedAt) return { stale: false, label: '' };
  const hours = (Date.now() - new Date(updatedAt).getTime()) / 3600000;
  if (!Number.isFinite(hours)) return { stale: false, label: '' };
  if (hours < 1) return { stale: false, label: 'set just now' };
  if (hours < 16) return { stale: false, label: `set ${Math.round(hours)}h ago` };
  const days = Math.round(hours / 24);
  return { stale: true, label: days <= 1 ? 'set yesterday or earlier' : `set ${days} days ago` };
}

export default { useLineCrew, crewStamp, crewAge };
