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

  // The general form of the same crash, which the check above was too specific
  // to catch. A useMemo body runs DURING RENDER, so every `const` it reads must
  // already have been initialised — a memo placed above the useState lines it
  // depends on throws "Cannot access 'X' before initialization" on first render
  // and the app shows an error screen instead of itself.
  //
  // This shipped: historyVisits was written above the state it reads, the build
  // passed, the tests passed, and the page was blank in production.
  //
  // Only useMemo is scanned. A useCallback body does not run at render time, so
  // naming a later const inside one is fine and flagging it would be noise.
  it('has no useMemo reading a const declared below it', () => {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');

    // Top-level declarations split the file into component scopes, so a memo in
    // one component is never compared against a name declared in another.
    const scopeStarts = lines.reduce((acc, l, i) => {
      if (/^(export default )?function \w+|^const \w+ = (\(|\w+ =>)/.test(l)) acc.push(i);
      return acc;
    }, [0]);
    const scopeOf = (i) => scopeStarts.filter((s) => s <= i).pop() ?? 0;

    // `const [x, setX] = useState(…)` / `const x = useMemo|useRef|useState(…)`
    const declaredAt = new Map();      // name -> line index
    lines.forEach((l, i) => {
      const arr = l.match(/^\s*const \[\s*(\w+)/);
      const one = l.match(/^\s*const (\w+)\s*=\s*(useMemo|useRef|useState|useCallback)\(/);
      const name = arr?.[1] || one?.[1];
      if (name && !declaredAt.has(name)) declaredAt.set(name, i);
    });

    const offenders = [];
    const re = /useMemo\(/g;
    let m;
    while ((m = re.exec(src))) {
      const startLine = src.slice(0, m.index).split('\n').length - 1;
      // Walk braces/parens from the useMemo( to find where its body ends.
      let depth = 0, end = m.index;
      for (let i = m.index + 'useMemo'.length; i < src.length; i += 1) {
        const c = src[i];
        if (c === '(') depth += 1;
        else if (c === ')') { depth -= 1; if (depth === 0) { end = i; break; } }
      }
      const body = src.slice(m.index, end);
      const scope = scopeOf(startLine);

      new Set(body.match(/(?<![A-Za-z0-9_.'"`])[A-Za-z_]\w*/g) || []).forEach((id) => {
        const at = declaredAt.get(id);
        if (at === undefined) return;
        if (at <= startLine) return;               // declared first — fine
        if (scopeOf(at) !== scope) return;         // a different component
        offenders.push(`  line ${startLine + 1}: useMemo reads \`${id}\`, declared at line ${at + 1}`);
      });
    }

    expect(
      [...new Set(offenders)],
      `A useMemo runs during render and cannot read a const declared below it.\n`
      + `Move the useMemo below these declarations:\n${[...new Set(offenders)].join('\n')}`
    ).toEqual([]);
  });
});

// A JSX prop referencing an identifier the file never defines.
//
// `requireEditAuth={requireDestructiveAuth}` was pasted into BOTH apps, but
// that function exists only in the plant app — JTI's own app has no crew roster
// to prove yourself against. It compiled cleanly (an identifier reference is
// valid syntax; only evaluating it throws) and shipped, and the screen died
// with "requireDestructiveAuth is not defined" the moment a visit was opened.
//
// The build cannot catch this and neither can a test that never renders. A
// scan can: every identifier passed as a JSX prop must be declared somewhere in
// its own file.
describe.each(APPS)('%s App.jsx', (_name, file) => {
  it('passes no JSX prop bound to an identifier the file never declares', () => {
    const src = readFileSync(file, 'utf8');

    // Names this file brings into scope: imports, declarations, destructured
    // bindings, function params, and loop/callback parameters.
    const declared = new Set(['true', 'false', 'null', 'undefined', 'this']);
    const add = (re, group = 1) => {
      for (const m of src.matchAll(re)) {
        for (const part of m[group].split(/[,{}[\]\s:]+/)) {
          const n = part.replace(/\.\.\./, '').trim();
          if (/^[A-Za-z_$][\w$]*$/.test(n)) declared.add(n);
        }
      }
    };
    add(/\bimport\s+([^;]+?)\s+from\s/g);
    add(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g);
    add(/\b(?:const|let|var)\s*(\{[^}]*\}|\[[^\]]*\])\s*=/g);
    add(/\(([^)]*)\)\s*=>/g);              // arrow params
    add(/\bfunction\s*\w*\s*\(([^)]*)\)/g); // function params
    add(/\bcatch\s*\(([^)]*)\)/g);
    // Globals a browser bundle legitimately reaches for.
    ['window', 'document', 'console', 'localStorage', 'navigator', 'firebase',
     'Date', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
     'Promise', 'Set', 'Map', 'React', 'URL', 'Blob', 'FileReader', 'Image',
     'setTimeout', 'setInterval', 'fetch', 'alert', 'confirm', 'performance',
     'CustomEvent', 'Event', 'Intl', 'crypto', 'atob', 'btoa', 'structuredClone',
    ].forEach((g) => declared.add(g));

    // prop={identifier} — a bare identifier only, not an expression.
    const offenders = [];
    for (const m of src.matchAll(/\s([a-zA-Z][\w]*)=\{([A-Za-z_$][\w$]*)\}/g)) {
      const [, prop, ident] = m;
      if (declared.has(ident)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`  line ${line}: ${prop}={${ident}} — ${ident} is never declared in this file`);
    }

    expect(
      [...new Set(offenders)],
      `A JSX prop is bound to an identifier this file does not define. It will\n`
      + `compile and then throw "<name> is not defined" when the component renders:\n`
      + `${[...new Set(offenders)].join('\n')}`,
    ).toEqual([]);
  });
});
