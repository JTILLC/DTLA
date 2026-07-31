// Guard against the temporal-dead-zone crash in App.jsx.
//
// AppContent declares `const user = session` a long way down the component, but
// `session` exists from the top. Any hook in the upper half that names `user`
// throws "Cannot access 'user' before initialization" on EVERY render — the app
// renders nothing at all, in production, with a stack of minified names.
//
// It has happened twice. The second time it shipped to production and sat there
// through two deploys, because a build succeeding says nothing about whether
// the app can render. A test does.
//
// Checked as source text on purpose: importing App.jsx would need the whole
// Firebase and router environment, and the thing being asserted is a property
// of the source itself.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const APPS = [
  ['CCW production', resolve(here, 'App.jsx')],
  ['CCW multi-tenant', resolve(here, '../../CCWISSUESMultiTenant/src/App.jsx')],
];

// `user` as a bare identifier: not a property (`x.user`), not part of a longer
// name (`userId`, `currentUser`), and not inside a string.
const BARE_USER = /(?<![A-Za-z0-9_.'"`])user(?![A-Za-z0-9_])/;

describe.each(APPS)('%s App.jsx', (_name, file) => {
  it('never reads `user` above the line that declares it', () => {
    const lines = readFileSync(file, 'utf8').split('\n');
    const start = lines.findIndex((l) => l.includes('const AppContent'));
    const declared = lines.findIndex((l) => /^\s*const user = session;/.test(l));

    // If either anchor moves, this test must be revisited rather than silently
    // passing over a file it no longer understands.
    expect(start, 'AppContent not found').toBeGreaterThan(-1);
    expect(declared, '`const user = session` not found').toBeGreaterThan(start);

    const offenders = lines
      .slice(start, declared)
      .map((line, i) => [start + i + 1, line])
      .filter(([, line]) => BARE_USER.test(line.split('//')[0]))
      .map(([n, line]) => `  line ${n}: ${line.trim()}`);

    expect(
      offenders,
      `\`user\` is in its temporal dead zone here — use \`session\` instead:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
