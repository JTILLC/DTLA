import { describe, it, expect } from 'vitest';
import navmap from '../data/navmap.json';
import { initialPresets, migratePresets, initialPick, pickRow, canCopy, copyPreset, wipeMemory } from './presetManager';

const spec = navmap.presetManager;

describe('Preset Manager', () => {
  it('opens with POTATO CHIPS in Memory slot 1 and an empty Card', () => {
    const p = initialPresets(spec);
    expect(p.memory[0]).toBe('POTATO CHIPS');
    expect(p.memory.slice(1).every((v) => v === '')).toBe(true);
    expect(p.card.every((v) => v === '')).toBe(true);
  });

  it('copies from the source row to the destination row, as seen: 1 -> 4', () => {
    let pick = initialPick();
    expect(canCopy(pick)).toBe(false);
    pick = pickRow(pick, 'src', 1);
    pick = pickRow(pick, 'dst', 4);
    expect(canCopy(pick)).toBe(true);
    const p = copyPreset(initialPresets(spec), pick, 'memory', 'memory');
    expect(p.memory[3]).toBe('POTATO CHIPS');
    expect(p.memory[0]).toBe('POTATO CHIPS');
  });

  it('copies between stores, and an empty source empties the destination', () => {
    let p = initialPresets(spec);
    p = copyPreset(p, { src: 1, dst: 2 }, 'memory', 'card');
    expect(p.card[1]).toBe('POTATO CHIPS');
    p = copyPreset(p, { src: 5, dst: 2 }, 'memory', 'card');
    expect(p.card[1]).toBe('');
  });

  it('a second tap on the same row clears it; Initialize wipes Memory only', () => {
    expect(pickRow({ src: 3, dst: null }, 'src', 3).src).toBeNull();
    let p = copyPreset(initialPresets(spec), { src: 1, dst: 1 }, 'memory', 'card');
    p = wipeMemory(p);
    expect(p.memory.every((v) => v === '')).toBe(true);
    expect(p.card[0]).toBe('POTATO CHIPS');
    expect(migratePresets({ memory: ['A'] }, spec).memory[0]).toBe('POTATO CHIPS');
  });
});
