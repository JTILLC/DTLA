// The distinction that stops "Open PDF" opening the dashboard again.
import { describe, it, expect } from 'vitest';
import { isAbsoluteUrl, needsResolving } from './fileRef.js';

describe('isAbsoluteUrl', () => {
  it('accepts a Firebase download URL, token and all', () => {
    expect(isAbsoluteUrl('https://firebasestorage.googleapis.com/v0/b/x/o/y.pdf?alt=media&token=abc')).toBe(true);
    expect(isAbsoluteUrl('http://example.com/a.pdf')).toBe(true);
    expect(isAbsoluteUrl('HTTPS://EXAMPLE.COM/a.pdf')).toBe(true);
  });

  it('rejects a bare storage path — the shape that caused the bug', () => {
    // In an href this resolves to jti-dashboard.pages.dev/user_files/... and
    // the SPA's catch-all serves index.html, so the app opens itself.
    expect(isAbsoluteUrl('user_files/tgez.../visits/abc/report.pdf')).toBe(false);
    expect(isAbsoluteUrl('manual-reports/abc/invoice.pdf')).toBe(false);
  });

  it('rejects a leading-slash path, which looks absolute but is not', () => {
    expect(isAbsoluteUrl('/user_files/abc/report.pdf')).toBe(false);
  });

  it('rejects nothing at all', () => {
    ['', null, undefined, '   '].forEach((v) => expect(isAbsoluteUrl(v)).toBe(false));
  });
});

describe('needsResolving', () => {
  it('is true only for a real path', () => {
    expect(needsResolving('user_files/a/b.pdf')).toBe(true);
    expect(needsResolving('https://example.com/a.pdf')).toBe(false);
  });

  it('is false for nothing — there is no file to resolve', () => {
    // Must not report "resolving" for a row that simply has no attachment.
    ['', null, undefined, '  '].forEach((v) => expect(needsResolving(v)).toBe(false));
  });
});
