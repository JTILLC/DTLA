import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// The storage contract useVerifiedPerson relies on, exercised directly: the
// hook needs a DOM to run, but the rule that matters — when a remembered
// person lapses — is pure and worth pinning on its own.
const KEY = 'ccw-verified-person:cust1';
const IDLE_MS = 15 * 60 * 1000;

const store = new Map();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

// Mirrors read() in useVerifiedPerson.js.
const read = () => {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const v = JSON.parse(raw);
  if (!v?.name || !v?.at) return null;
  if (Date.now() - v.at > IDLE_MS) { localStorage.removeItem(KEY); return null; }
  return v;
};
const remember = (name, at = Date.now()) =>
  localStorage.setItem(KEY, JSON.stringify({ id: 'p1', name, at }));
const touch = () => {
  const raw = localStorage.getItem(KEY);
  if (!raw) return;
  localStorage.setItem(KEY, JSON.stringify({ ...JSON.parse(raw), at: Date.now() }));
};

describe('how long a confirmed person is remembered', () => {
  it('holds while someone is working', () => {
    remember('J. Rodriguez', Date.now() - 5 * 60 * 1000);   // 5 minutes ago
    expect(read()?.name).toBe('J. Rodriguez');
  });

  it('lapses once the tablet has been idle past the window', () => {
    // The failure this guards: someone walks away, the next person picks it up,
    // and their work is filed under a name that is still sitting there.
    remember('J. Rodriguez', Date.now() - (IDLE_MS + 1000));
    expect(read()).toBeNull();
  });

  it('clears the stored value when it lapses, rather than leaving it to rot', () => {
    remember('J. Rodriguez', Date.now() - (IDLE_MS + 1000));
    read();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('is kept alive by use, so continuous work never re-prompts', () => {
    remember('J. Rodriguez', Date.now() - 14 * 60 * 1000);  // nearly lapsed
    touch();                                                // ...then they file something
    expect(read()?.name).toBe('J. Rodriguez');
  });

  it('is NOT kept alive by time alone — only by use', () => {
    remember('J. Rodriguez', Date.now() - 14 * 60 * 1000);
    // no touch: two more minutes of nothing happening
    vi.setSystemTime(new Date(Date.now() + 2 * 60 * 1000));
    expect(read()).toBeNull();
    vi.useRealTimers();
  });

  it('is nobody when nothing was ever confirmed', () => {
    expect(read()).toBeNull();
  });
});
