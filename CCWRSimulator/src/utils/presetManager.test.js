import { describe, it, expect } from 'vitest';
import navmap from '../data/navmap.json';
import {
  initialStores, migrateStores, initialPick, pickRow, canCopy, copyItem, wipeMemory,
  initialManagers, migrateManagers, managerOf, selectAll, resetManager, ALL,
} from './presetManager';

const specs = navmap.copyManagers;
const preset = specs.preset;
const machine = specs.machine;

describe('the copy managers', () => {
  it('Preset Manager opens with POTATO CHIPS in Memory slot 1 and an empty Card', () => {
    const p = initialStores(preset);
    expect(p.memory[0]).toBe('POTATO CHIPS');
    expect(p.memory.slice(1).every((v) => v === '')).toBe(true);
    expect(p.card.every((v) => v === '')).toBe(true);
  });

  it('Machine Set Mngr opens with the ten setting groups in Memory, slot 8 empty', () => {
    const m = initialStores(machine);
    expect(m.memory[0]).toBe('Weigh Spec Setting');
    expect(m.memory[7]).toBe('');
    expect(m.memory[9]).toBe('Frequency Setting');
    expect(m.card.every((v) => v === '')).toBe(true);
  });

  it('copies from the source row to the destination row, as seen: 1 -> 4', () => {
    let pick = initialPick();
    expect(canCopy(pick)).toBe(false);
    pick = pickRow(pick, 'src', 1);
    pick = pickRow(pick, 'dst', 4);
    expect(canCopy(pick)).toBe(true);
    const p = copyItem(initialStores(preset), pick, 'memory', 'memory');
    expect(p.memory[3]).toBe('POTATO CHIPS');
    expect(p.memory[0]).toBe('POTATO CHIPS');
  });

  it('an empty source copied over a slot empties it - how a preset is removed', () => {
    let p = initialStores(preset);
    p = copyItem(p, { src: 1, dst: 2 }, 'memory', 'card');
    expect(p.card[1]).toBe('POTATO CHIPS');
    p = copyItem(p, { src: 5, dst: 2 }, 'memory', 'card');
    expect(p.card[1]).toBe('');
    p = copyItem(p, { src: 2, dst: 1 }, 'memory', 'memory');
    expect(p.memory[0]).toBe('');
  });

  it('a second tap on the same row clears it; Initialize wipes Memory only', () => {
    expect(pickRow({ src: 3, dst: null }, 'src', 3).src).toBeNull();
    let p = copyItem(initialStores(preset), { src: 1, dst: 1 }, 'memory', 'card');
    p = wipeMemory(p);
    expect(p.memory.every((v) => v === '')).toBe(true);
    expect(p.card[0]).toBe('POTATO CHIPS');
    expect(migrateStores({ memory: ['A'] }, preset).memory[0]).toBe('POTATO CHIPS');
  });

  it('All Select turns every source row blue and Copy writes all ten slots across', () => {
    let pick = selectAll(initialPick());
    expect(pick.src).toBe(ALL);
    expect(canCopy(pick)).toBe(true);
    const m = copyItem(initialStores(machine), pick, 'memory', 'card');
    expect(m.card).toEqual(m.memory);
    expect(m.card[7]).toBe('');
    // a row tapped after All Select picks that row alone; All Select again clears
    expect(pickRow(pick, 'src', 3).src).toBe(3);
    expect(selectAll(pick).src).toBeNull();
    // and the same store as source and destination changes nothing
    expect(copyItem(initialStores(preset), pick, 'memory', 'memory')).toEqual(initialStores(preset));
  });

  it('leaving the tab resets it', () => {
    const changed = copyItem(initialStores(preset), { src: 1, dst: 3 }, 'memory', 'memory');
    expect(changed.memory[2]).toBe('POTATO CHIPS');
    expect(resetManager(preset).stores.memory[2]).toBe('');
    expect(resetManager(preset).pick).toEqual({ src: null, dst: null });
  });

  it('each manager keeps its own stores and picks, and its pop-ups map back to it', () => {
    const all = initialManagers(specs);
    expect(Object.keys(all).sort()).toEqual(['machine', 'preset']);
    expect(all.machine.stores.memory[1]).toBe('Combination Set');
    const m = migrateManagers({ preset: { stores: { memory: Array(10).fill('X'), card: Array(10).fill('') } } }, specs);
    expect(m.preset.stores.memory[0]).toBe('X');
    expect(m.machine.stores.memory[0]).toBe('Weigh Spec Setting');
    expect(managerOf(specs, navmap.screens, 'display-preset@copy')).toBe('preset');
    expect(managerOf(specs, navmap.screens, 'display-machine-edit')).toBe('machine');
    expect(managerOf(specs, navmap.screens, 'main-menu')).toBeNull();
  });
});
