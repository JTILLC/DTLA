// The style kit. Small surface, but four components depend on it, so the
// contract worth pinning is that an override changes one property and leaves
// the shared shape alone — that is the whole reason it exists.
import { describe, it, expect } from 'vitest';
import { TONE, tint, card, label, input, cell, btn, pill } from './theme.js';

const colors = { cardBg: '#111', text: '#eee', textSecondary: '#999', border: '#333', inputBg: '#181818' };

describe('tint', () => {
  it('turns a hex tone into a translucent rgba', () => {
    expect(tint('#3b82f6', 0.12)).toBe('rgba(59, 130, 246, 0.12)');
  });

  it('copes with a missing hash', () => {
    expect(tint('10b981', 0.3)).toBe('rgba(16, 185, 129, 0.3)');
  });
});

describe('the shared shapes', () => {
  it('read their colours from the theme rather than hardcoding them', () => {
    expect(card(colors).background).toBe(colors.cardBg);
    expect(label(colors).color).toBe(colors.textSecondary);
    expect(input(colors).color).toBe(colors.text);
    expect(cell(colors).borderBottom).toContain(colors.border);
  });

  it('let a caller override ONE property and keep the rest', () => {
    // The drift started because changing one thing meant re-declaring all of
    // it, so this is the property that stops it happening again.
    const wide = input(colors, { width: '100%' });
    expect(wide.width).toBe('100%');
    expect(wide.borderRadius).toBe(input(colors).borderRadius);
    expect(wide.color).toBe(colors.text);
  });

  it('survives a theme that is missing the optional keys', () => {
    const bare = { cardBg: '#fff', text: '#000', textSecondary: '#666' };
    expect(input(bare).border).toContain('#d1d5db');
    expect(cell(bare).borderBottom).toContain('#e5e7eb');
  });
});

describe('btn', () => {
  it('an inactive button is an outline, not a filled one', () => {
    const b = btn(colors);
    expect(b.background).toBe(colors.cardBg);
    expect(b.color).toBe(colors.text);
  });

  it('an active button is filled with its tone, so the current panel is obvious', () => {
    const b = btn(colors, { tone: TONE.pink, active: true });
    expect(b.background).toBe(TONE.pink);
    expect(b.color).toBe('#fff');
  });

  it('falls back to brand when made active without a tone', () => {
    expect(btn(colors, { active: true }).background).toBe(TONE.brand);
  });

  it('has a small size for dense rows', () => {
    expect(btn(colors, { size: 'sm' }).padding).not.toBe(btn(colors).padding);
  });
});

describe('pill', () => {
  it('is tinted from its tone rather than a separate hardcoded pair', () => {
    const p = pill(TONE.warn);
    expect(p.color).toBe(TONE.warn);
    expect(p.background).toContain('245, 158, 11');
    expect(p.border).toContain('245, 158, 11');
  });
});
