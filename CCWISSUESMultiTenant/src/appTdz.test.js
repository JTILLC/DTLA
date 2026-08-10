// Render-crash guards for THIS app's App.jsx.
//
// The checks themselves live in shared/utils/sourceGuards.js. They used to live
// only in CCWISSUESGitHub's test file while scanning both apps — so editing
// this app, running this app's tests, and deploying never executed them. That
// is exactly how a useMemo reading a const declared 120 lines below it reached
// production and white-screened Headcount on 10 Aug 2026.
//
// A guard has to run in the suite of the code it guards.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  bareUserAboveDeclaration, memoReadingLaterConst, jsxPropsWithUndeclaredIdentifiers,
} from '@shared/utils/sourceGuards.js';

const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'App.jsx'), 'utf8');

describe('Headcount App.jsx', () => {
  it('never reads `user` above the line that declares it', () => {
    const { anchorsFound, offenders } = bareUserAboveDeclaration(src);
    expect(anchorsFound, 'AppContent / `const user = session` anchors not found — revisit this test').toBe(true);
    expect(offenders, `\`user\` is in its temporal dead zone here — use \`session\`:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('has no useMemo reading a const declared below it', () => {
    const offenders = memoReadingLaterConst(src);
    expect(offenders,
      'A useMemo runs during render and cannot read a const declared below it.\n'
      + `Move it below these declarations:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('passes no JSX prop bound to an identifier the file never declares', () => {
    const offenders = jsxPropsWithUndeclaredIdentifiers(src);
    expect(offenders,
      'A JSX prop is bound to an identifier this file does not define. It compiles,\n'
      + `then throws "<name> is not defined" on render:\n${offenders.join('\n')}`).toEqual([]);
  });
});
