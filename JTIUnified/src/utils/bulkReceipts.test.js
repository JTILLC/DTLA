// Deciding which job each of several hundred old receipts belongs to.
//
// The expensive mistake is a confident wrong answer: a receipt filed against
// the wrong service report inflates one job's costs and understates another's,
// and nothing downstream can tell. So most of these tests are about what it
// REFUSES to match.
import { describe, it, expect } from 'vitest';
import { detectSr, candidateSrs, planImport, summarise, IMPORTABLE } from './bulkReceipts.js';

const known = ['2026024', '2026018', '2025042', '2022001'];
const f = (path, name) => ({ name: name || path.split('/').pop(), webkitRelativePath: path });

describe('candidateSrs', () => {
  it('reads the shapes people actually name things', () => {
    expect(candidateSrs('2026024')).toEqual(['2026024']);
    expect(candidateSrs('SR 2026024 fuel.jpg')).toEqual(['2026024']);
    expect(candidateSrs('2026-024')).toEqual(['2026024']);
    expect(candidateSrs('2026_024 receipt')).toEqual(['2026024']);
  });

  it('finds several when several are present', () => {
    expect(candidateSrs('2026024 and 2026018')).toEqual(['2026024', '2026018']);
  });

  it('is not fooled by other long numbers', () => {
    expect(candidateSrs('invoice 998877')).toEqual([]);
    expect(candidateSrs('IMG_20260812_1422.jpg')).toEqual([]);
  });
});

describe('detectSr', () => {
  it('reads the job from the folder', () => {
    expect(detectSr('2026024/fuel.jpg', known)).toBe('2026024');
    expect(detectSr('Receipts/2025042/shell.png', known)).toBe('2025042');
  });

  it('reads it from the filename when there is no folder', () => {
    expect(detectSr('SR2026018 parts.pdf', known)).toBe('2026018');
  });

  it('prefers the FOLDER over a number in the filename', () => {
    // Somebody put this file in the 2026024 folder; the other number is a note.
    expect(detectSr('2026024/receipt from 2026018.jpg', known)).toBe('2026024');
  });

  it('prefers the deepest folder', () => {
    expect(detectSr('2025042/extras/2026024/fuel.jpg', known)).toBe('2026024');
  });

  it('REFUSES a number that is not a known job', () => {
    // A folder named for a year, or an unrelated seven-digit number, must not
    // invent a packet for a job that never existed.
    expect(detectSr('2019/fuel.jpg', known)).toBeNull();
    expect(detectSr('2026999/fuel.jpg', known)).toBeNull();
    expect(detectSr('Receipts/2024/june/fuel.jpg', known)).toBeNull();
  });

  it('returns null rather than guessing when there is nothing to go on', () => {
    expect(detectSr('IMG_0421.jpg', known)).toBeNull();
    expect(detectSr('', known)).toBeNull();
    expect(detectSr('2026024/fuel.jpg', [])).toBeNull();   // nothing known yet
  });
});

describe('planImport', () => {
  it('sorts a pile into matched, unmatched and skipped', () => {
    const plan = planImport([
      f('2026024/fuel.jpg'),
      f('2026024/parts.pdf'),
      f('2025042/hotel.png'),
      f('loose/IMG_0421.jpg'),
      f('2026024/notes.txt'),
    ], known);

    expect(plan.matched.map((m) => m.sr)).toEqual(['2026024', '2026024', '2025042']);
    expect(plan.unmatched.map((u) => u.path)).toEqual(['loose/IMG_0421.jpg']);
    expect(plan.skipped[0].reason).toMatch(/not a JPEG/);
  });

  it('does not double receipts when the same folder is imported twice', () => {
    const existing = { 2026024: [{ name: 'fuel.jpg' }] };
    const plan = planImport([f('2026024/fuel.jpg'), f('2026024/new.jpg')], known, existing);
    expect(plan.matched.map((m) => m.file.name)).toEqual(['new.jpg']);
    expect(plan.skipped[0].reason).toBe('already on this job');
  });

  it('matches the sanitised name, since that is what upload stores', () => {
    const existing = { 2026024: [{ name: 'fuel_receipt.jpg' }] };
    const plan = planImport([f('2026024/fuel receipt.jpg')], known, existing);
    expect(plan.skipped).toHaveLength(1);
  });

  it('copes with plain filenames when no folder was chosen', () => {
    const plan = planImport([{ name: '2026018 fuel.jpg' }], known);
    expect(plan.matched[0].sr).toBe('2026018');
  });

  it('survives an empty pile', () => {
    expect(planImport([], known)).toEqual({ matched: [], unmatched: [], skipped: [] });
  });
});

describe('summarise', () => {
  it('says what the run will do before it does it', () => {
    const plan = planImport([f('2026024/a.jpg'), f('2026024/b.jpg'), f('2025042/c.jpg'), f('x/IMG_1.jpg')], known);
    expect(summarise(plan)).toBe('3 receipts across 2 jobs · 1 with no job');
  });

  it('reads sensibly for one of everything', () => {
    expect(summarise({ matched: [{ sr: '2026024' }] })).toBe('1 receipt across 1 job');
  });
});

describe('IMPORTABLE', () => {
  it('accepts the formats the packet can actually merge', () => {
    ['a.jpg', 'a.jpeg', 'a.JPG', 'a.png', 'a.pdf'].forEach((n) => expect(IMPORTABLE.test(n)).toBe(true));
  });

  it('rejects what it cannot', () => {
    ['a.heic', 'a.txt', 'a.docx', 'a'].forEach((n) => expect(IMPORTABLE.test(n)).toBe(false));
  });
});
