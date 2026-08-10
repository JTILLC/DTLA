// The whole value of this check is that it stays quiet unless it is certain.
// A false "update available" bar trains people to ignore it, and a missed one
// leaves somebody testing a build that no longer exists.
import { describe, it, expect } from 'vitest';
import { bundleFromHtml, isStale, runningBundle } from './buildVersion.js';

describe('bundleFromHtml', () => {
  it('picks the entry bundle out of a served index.html', () => {
    const html = `<!doctype html><html><head>
      <script type="module" crossorigin src="/assets/index-bn7vjCDy.js"></script>
      <link rel="stylesheet" href="/assets/index-CLXWMGZe.css">
    </head><body><div id="root"></div></body></html>`;
    expect(bundleFromHtml(html)).toBe('index-bn7vjCDy.js');
  });

  it('is not fooled by the stylesheet, which is hashed the same way', () => {
    expect(bundleFromHtml('<link href="/assets/index-CLXWMGZe.css">')).toBeNull();
  });

  it('ignores other hashed chunks', () => {
    const html = '<script src="/assets/FactoryLayout-B8Y5lUaZ.js"></script>';
    expect(bundleFromHtml(html)).toBeNull();
  });

  it('gives nothing rather than a guess', () => {
    expect(bundleFromHtml('')).toBeNull();
    expect(bundleFromHtml(undefined)).toBeNull();
    expect(bundleFromHtml('<h1>502 Bad Gateway</h1>')).toBeNull();
  });
});

describe('isStale', () => {
  it('is true only when both are known and they differ', () => {
    expect(isStale('index-aaa.js', 'index-bbb.js')).toBe(true);
  });

  it('is false when they match', () => {
    expect(isStale('index-aaa.js', 'index-aaa.js')).toBe(false);
  });

  it('never fires on an unknown — offline must not look like an update', () => {
    expect(isStale('index-aaa.js', null)).toBe(false);
    expect(isStale(null, 'index-bbb.js')).toBe(false);
    expect(isStale(null, null)).toBe(false);
    expect(isStale('index-aaa.js', '')).toBe(false);
  });
});

describe('runningBundle', () => {
  const docWith = (srcs) => ({
    querySelectorAll: () => srcs.map((src) => ({ getAttribute: () => src })),
  });

  it('reads the entry bundle off the live document', () => {
    expect(runningBundle(docWith([
      '/bootstrap.bundle.min.js',
      '/assets/index-bn7vjCDy.js',
    ]))).toBe('index-bn7vjCDy.js');
  });

  it('survives a cache-busting query string', () => {
    expect(runningBundle(docWith(['/assets/index-bn7vjCDy.js?v=2']))).toBe('index-bn7vjCDy.js');
  });

  it('returns null when there is no hashed bundle (dev server)', () => {
    expect(runningBundle(docWith(['/src/main.jsx']))).toBeNull();
    expect(runningBundle(null)).toBeNull();
  });
});
