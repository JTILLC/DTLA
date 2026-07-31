// Tests for the offline-photo reconciliation logic.
//
// This is the riskiest code in the offline path and the hardest to exercise by
// hand (it needs a real dead zone, a reconnect, and precise timing), so the pure
// core is covered here instead. The scenarios below are the ones that actually
// lose a customer's photo if the logic is wrong.
import { describe, it, expect } from 'vitest';
import { replacePendingPhoto } from './photoSync.js';

const resolved = { url: 'https://storage/photo.jpg', path: 'issue-photos/x/y.jpg' };

const lines = () => [
  {
    id: 1,
    title: 'Line 1',
    heads: [
      {
        id: 1,
        photos: [{ pendingId: 'p1' }],
        issues: [{ type: 'Chute', photos: [{ pendingId: 'p2' }] }],
      },
      {
        id: 2,
        photos: [{ url: 'https://storage/already.jpg', path: 'a.jpg' }],
        issues: [],
      },
    ],
  },
];

describe('replacePendingPhoto', () => {
  it('replaces a head-level placeholder', () => {
    const [next, count] = replacePendingPhoto(lines(), 'p1', resolved);
    expect(count).toBe(1);
    expect(next[0].heads[0].photos[0]).toEqual(resolved);
  });

  it('replaces an issue-level placeholder', () => {
    const [next, count] = replacePendingPhoto(lines(), 'p2', resolved);
    expect(count).toBe(1);
    expect(next[0].heads[0].issues[0].photos[0]).toEqual(resolved);
  });

  it('leaves already-uploaded photos untouched', () => {
    const [next] = replacePendingPhoto(lines(), 'p1', resolved);
    expect(next[0].heads[1].photos[0]).toEqual({
      url: 'https://storage/already.jpg',
      path: 'a.jpg',
    });
  });

  it('reports zero when the placeholder is gone (head/issue deleted while queued)', () => {
    // The drainer treats 0 as "drop the orphan" rather than retrying forever.
    const [, count] = replacePendingPhoto(lines(), 'does-not-exist', resolved);
    expect(count).toBe(0);
  });

  it('is idempotent — re-running after the swap changes nothing', () => {
    const [once] = replacePendingPhoto(lines(), 'p1', resolved);
    const [twice, count] = replacePendingPhoto(once, 'p1', resolved);
    expect(count).toBe(0);
    expect(twice[0].heads[0].photos[0]).toEqual(resolved);
  });

  it('does not mutate the input (autosave reads the previous array)', () => {
    const original = lines();
    replacePendingPhoto(original, 'p1', resolved);
    expect(original[0].heads[0].photos[0]).toEqual({ pendingId: 'p1' });
  });

  it('survives heads/issues/photos being missing entirely', () => {
    const sparse = [{ id: 1 }, { id: 2, heads: [{ id: 1 }] }];
    expect(() => replacePendingPhoto(sparse, 'p1', resolved)).not.toThrow();
    const [, count] = replacePendingPhoto(sparse, 'p1', resolved);
    expect(count).toBe(0);
  });

  it('handles a null/undefined lines array', () => {
    expect(replacePendingPhoto(undefined, 'p1', resolved)).toEqual([[], 0]);
  });

  it('replaces every occurrence of the same pending id', () => {
    // Defensive: the same placeholder should never legitimately appear twice,
    // but if it did, leaving one behind would strand a queue entry forever.
    const dupe = [
      {
        id: 1,
        heads: [
          { id: 1, photos: [{ pendingId: 'p1' }], issues: [{ photos: [{ pendingId: 'p1' }] }] },
        ],
      },
    ];
    const [, count] = replacePendingPhoto(dupe, 'p1', resolved);
    expect(count).toBe(2);
  });
});
