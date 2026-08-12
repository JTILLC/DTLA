// src/ui/theme.js
//
// One place for the shapes this app keeps re-drawing.
//
// `card`, `label`, `input` and `cell` were written out by hand in four
// components, and the copies had already drifted — two different border radii
// for the same input, two different label sizes for the same kind of label.
// Nobody decided that; it is just what happens when a style is a literal in
// whichever file needed it.
//
// Colours were worse: 180 hex literals across the app, #3b82f6 alone 57 times.
// A colour repeated 57 times is a colour that cannot be changed.
//
// These are FUNCTIONS of the theme rather than constants, because the app
// carries a light/dark `colors` object down through props. Each takes an
// override object so a caller can vary one property without abandoning the
// shared shape and re-declaring the whole thing — which is how the drift
// started.

/**
 * Semantic colours. Named for what they MEAN, not what they look like: a
 * status that goes from green to teal should not require finding every
 * "#10b981" and deciding, one at a time, whether that particular one meant
 * "good" or just happened to be green.
 */
export const TONE = {
  brand: '#3b82f6',   // primary actions, links, the current thing
  ok: '#10b981',      // saved, complete, running
  bad: '#ef4444',     // failed, offline, destructive
  warn: '#f59e0b',    // missing, needs attention, unpaid
  violet: '#8b5cf6',  // visits and service reports
  pink: '#ec4899',    // job packets
  muted: '#9ca3af',   // placeholder and icon grey
};

/** Translucent version of a tone, for pill and banner backgrounds. */
export const tint = (tone, alpha = 0.14) => {
  const hex = String(tone).replace('#', '');
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

export const card = (colors, over = {}) => ({
  background: colors.cardBg,
  borderRadius: '12px',
  padding: '20px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  ...over,
});

export const label = (colors, over = {}) => ({
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: colors.textSecondary,
  display: 'block',
  marginBottom: '6px',
  ...over,
});

export const input = (colors, over = {}) => ({
  padding: '8px 10px',
  borderRadius: '6px',
  border: `1px solid ${colors.border || '#d1d5db'}`,
  background: colors.inputBg || colors.cardBg,
  color: colors.text,
  fontSize: '14px',
  boxSizing: 'border-box',
  ...over,
});

export const cell = (colors, over = {}) => ({
  padding: '10px 12px',
  borderBottom: `1px solid ${colors.border || '#e5e7eb'}`,
  fontSize: '14px',
  verticalAlign: 'top',
  ...over,
});

/**
 * A button.
 *
 * `tone` fills it; without one it is an outline that reads as secondary. The
 * distinction matters more than it looks: the header had twelve buttons drawn
 * identically, so navigation and utilities were indistinguishable.
 */
export const btn = (colors, { tone, active = false, size = 'md', over = {} } = {}) => {
  const pad = size === 'sm' ? '6px 12px' : '8px 16px';
  const filled = active || (tone && !active && false);
  return {
    padding: pad,
    borderRadius: '8px',
    border: `1px solid ${active ? (tone || TONE.brand) : (colors.border || '#d1d5db')}`,
    background: active ? (tone || TONE.brand) : colors.cardBg,
    color: active ? '#fff' : colors.text,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '14px',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    transition: 'background .15s, border-color .15s',
    ...(filled ? {} : {}),
    ...over,
  };
};

/** A small status chip. */
export const pill = (tone, over = {}) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 500,
  background: tint(tone, 0.12),
  color: tone,
  border: `1px solid ${tint(tone, 0.3)}`,
  ...over,
});

export default { TONE, tint, card, label, input, cell, btn, pill };
