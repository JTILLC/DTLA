import { describe, it, expect } from 'vitest';
import { boardFor, outstandingLines, issueCount, buildSubmission, unanswered } from './prestart.js';

const NOW = new Date(2026, 7, 3, 9, 0);            // Mon 3 Aug 2026, 09:00
const at = (d, h = 6, m = 0) => new Date(2026, 7, d, h, m).toISOString();

const entry = (lineTitle, performedAt, over = {}) => ({ lineTitle, performedAt, items: [], ...over });

describe('boardFor', () => {
  const lines = [{ title: 'Line 1' }, { title: 'Line 2' }, { title: 'Line 3' }];

  it('marks a line checked today as done', () => {
    const board = boardFor(lines, [entry('Line 1', at(3))], NOW);
    expect(board.find((b) => b.lineTitle === 'Line 1').doneToday).toBe(true);
    expect(board.find((b) => b.lineTitle === 'Line 2').doneToday).toBe(false);
  });

  it('does not count yesterday as done, even ten hours ago', () => {
    const board = boardFor(lines, [entry('Line 1', at(2, 23, 50))], NOW);
    expect(board[0].doneToday).toBe(false);
    expect(board[0].entry).not.toBe(null);   // still shown, just not today
  });

  it('keeps the most recent check per line', () => {
    const board = boardFor(lines, [
      entry('Line 1', at(3, 6), { id: 'early' }),
      entry('Line 1', at(3, 14), { id: 'late' }),
    ], NOW);
    expect(board[0].entry.id).toBe('late');
  });

  it('returns lines in the order given', () => {
    expect(boardFor(lines, [], NOW).map((b) => b.lineTitle)).toEqual(['Line 1', 'Line 2', 'Line 3']);
  });

  it('accepts plain title strings as well as line objects', () => {
    expect(boardFor(['Line 9'], [entry('Line 9', at(3))], NOW)[0].doneToday).toBe(true);
  });

  it('ignores entries with no line, and junk timestamps do not win', () => {
    const board = boardFor(lines, [
      entry('', at(3)),
      entry('Line 1', 'whenever', { id: 'junk' }),
      entry('Line 1', at(3), { id: 'real' }),
    ], NOW);
    expect(board[0].entry.id).toBe('real');
  });

  it('survives nothing at all', () => {
    expect(boardFor([], [], NOW)).toEqual([]);
    expect(boardFor(undefined, undefined, NOW)).toEqual([]);
  });
});

describe('outstandingLines', () => {
  it('names the lines still to walk', () => {
    const board = boardFor([{ title: 'A' }, { title: 'B' }], [entry('A', at(3))], NOW);
    expect(outstandingLines(board)).toEqual(['B']);
  });
});

describe('issueCount', () => {
  it('counts only items marked as a problem', () => {
    expect(issueCount({ items: [{ result: 'issue' }, { result: 'ok' }, { result: 'issue' }] })).toBe(2);
  });
  it('does not treat N/A as a fault', () => {
    // Counting it would train people to tick OK on things that do not apply.
    expect(issueCount({ items: [{ result: 'na' }, { result: 'ok' }] })).toBe(0);
  });
  it('is zero for nothing', () => {
    expect(issueCount(null)).toBe(0);
    expect(issueCount({})).toBe(0);
  });
});

describe('buildSubmission', () => {
  const items = [
    { id: 'a', label: 'Dispersion table secure', type: 'check', imageUrl: '/fig.png' },
    { id: 'b', label: 'Reading', type: 'value' },
  ];

  it('copies the label in rather than referencing the template', () => {
    const out = buildSubmission({ items, answers: { a: 'ok', b: '12.4' } });
    expect(out[0].label).toBe('Dispersion table secure');
    expect(out[0].imageUrl).toBe('/fig.png');
  });

  it('puts a check answer in result and a reading in value, never both', () => {
    const out = buildSubmission({ items, answers: { a: 'issue', b: '12.4' } });
    expect(out[0]).toMatchObject({ result: 'issue', value: '' });
    expect(out[1]).toMatchObject({ result: '', value: '12.4' });
  });

  it('carries per-item notes', () => {
    const out = buildSubmission({ items, answers: { a: 'issue' }, notes: { a: 'rocking slightly' } });
    expect(out[0].note).toBe('rocking slightly');
  });
});

describe('unanswered', () => {
  const items = [
    { id: 'a', type: 'check' },
    { id: 'b', type: 'check' },
    { id: 'c', type: 'value' },
  ];
  it('lists check items with no answer', () => {
    expect(unanswered(items, { a: 'ok' }).map((i) => i.id)).toEqual(['b']);
  });
  it('never blocks on an empty reading', () => {
    // A value box with nothing to put in it must not stop a shift.
    expect(unanswered(items, { a: 'ok', b: 'na' })).toEqual([]);
  });
});
