// The rule that decides whether a finished save may redraw the screen.
//
// Getting this wrong is not a cosmetic bug: it undoes work somebody just did,
// silently, and only sometimes — which is why it survived so long. The tests
// are written as the three complaints that led here.
import { describe, it, expect } from 'vitest';
import { shouldAdoptMerge, localMovedOn } from './mergeApply.js';

const snap = (o) => JSON.stringify(o);

describe('localMovedOn', () => {
  it('is false when nothing changed while the write was in flight', () => {
    expect(localMovedOn('a', 'a')).toBe(false);
  });

  it('is true when the screen changed', () => {
    expect(localMovedOn('a', 'b')).toBe(true);
  });

  it('treats an unknown as moved on — we do not overwrite what we cannot check', () => {
    expect(localMovedOn(undefined, 'a')).toBe(true);
    expect(localMovedOn('a', null)).toBe(true);
    expect(localMovedOn(null, null)).toBe(true);
  });
});

describe('shouldAdoptMerge', () => {
  const sent = snap({ lines: [{ id: 1, head: 'active' }] });

  it('adopts another editor\'s change when this screen sat still', () => {
    expect(shouldAdoptMerge({
      sentSnapshot: sent,
      mergedSnapshot: snap({ lines: [{ id: 1, head: 'active' }, { id: 2 }] }),
      currentSnapshot: sent,
    })).toBe(true);
  });

  it('does nothing when the merge matches what we sent', () => {
    // Nothing to show, and re-rendering mid-typing for no reason is its own bug.
    expect(shouldAdoptMerge({ sentSnapshot: sent, mergedSnapshot: sent, currentSnapshot: sent })).toBe(false);
  });

  // The three complaints, as tests.
  it('does NOT put a head back online that was switched off during the save', () => {
    const offlineNow = snap({ lines: [{ id: 1, head: 'offline' }] });
    expect(shouldAdoptMerge({
      sentSnapshot: sent,
      mergedSnapshot: sent,          // the cloud still says active
      currentSnapshot: offlineNow,   // ...but the screen has moved on
    })).toBe(false);
  });

  it('does NOT reset an issue type chosen during the save', () => {
    expect(shouldAdoptMerge({
      sentSnapshot: sent,
      mergedSnapshot: snap({ lines: [{ id: 1, head: 'active', issue: 'Chute' }] }),
      currentSnapshot: snap({ lines: [{ id: 1, head: 'active', issue: 'Load cell' }] }),
    })).toBe(false);
  });

  it('does NOT clear text typed during the save', () => {
    expect(shouldAdoptMerge({
      sentSnapshot: snap({ notes: '' }),
      mergedSnapshot: snap({ notes: '' }),
      currentSnapshot: snap({ notes: 'seized bearing, ordered' }),
    })).toBe(false);
  });

  it('refuses rather than guesses when a snapshot is missing', () => {
    expect(shouldAdoptMerge({ sentSnapshot: sent, mergedSnapshot: sent, currentSnapshot: undefined })).toBe(false);
  });
});
