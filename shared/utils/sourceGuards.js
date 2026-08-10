// shared/utils/sourceGuards.js
//
// Render-time crashes that a build cannot see, found by reading the source.
//
// These are the failures that compile perfectly, pass every unit test, deploy,
// and then show a white screen with a minified name in it. All three have
// shipped to production at least once.
//
// Extracted from CCWISSUESGitHub's test file because that was the whole
// problem: the checks lived in ONE app's suite while scanning BOTH apps' source,
// so a change to the other app ran its own tests, passed, deployed — and the
// guard never executed. A guard that only runs when you happen to test the
// neighbouring project is not a guard.

// `user` as a bare identifier: not a property (`x.user`), not part of a longer
// name (`userId`, `currentUser`), and not inside a string.
const BARE_USER = /(?<![A-Za-z0-9_.'"`])user(?![A-Za-z0-9_])/;

/**
 * `const user = session` is declared a long way down these components, but
 * `session` exists from the top. Any hook above that line naming `user` throws
 * on EVERY render.
 */
export function bareUserAboveDeclaration(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.includes('const AppContent'));
  const declared = lines.findIndex((l) => /^\s*const user = session;/.test(l));
  if (start === -1 || declared <= start) return { anchorsFound: false, offenders: [] };

  const offenders = lines
    .slice(start, declared)
    .map((line, i) => [start + i + 1, line])
    .filter(([, line]) => BARE_USER.test(line.split('//')[0]))
    .map(([n, line]) => `  line ${n}: ${line.trim()}`);
  return { anchorsFound: true, offenders };
}

/**
 * A useMemo body runs DURING RENDER, so every const it reads must already be
 * initialised. A memo placed above the useState it depends on throws
 * "Cannot access 'X' before initialization" and the app shows an error screen.
 *
 * Only useMemo is scanned. A useCallback body does not run at render time, so
 * naming a later const inside one is fine and flagging it would be noise.
 */
export function memoReadingLaterConst(src) {
  const lines = src.split('\n');

  // Top-level declarations split the file into component scopes, so a memo in
  // one component is never compared against a name declared in another.
  const scopeStarts = lines.reduce((acc, l, i) => {
    if (/^(export default )?function \w+|^const \w+ = (\(|\w+ =>)/.test(l)) acc.push(i);
    return acc;
  }, [0]);
  const scopeOf = (i) => scopeStarts.filter((s) => s <= i).pop() ?? 0;

  const declaredAt = new Map();
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
    let depth = 0;
    let end = m.index;
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
  return [...new Set(offenders)];
}

/**
 * A JSX prop bound to an identifier the file never defines. It compiles — an
 * identifier reference is valid syntax, only evaluating it throws — and dies
 * the moment the component renders.
 */
export function jsxPropsWithUndeclaredIdentifiers(src) {
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
  add(/\(([^)]*)\)\s*=>/g);
  add(/\bfunction\s*\w*\s*\(([^)]*)\)/g);
  add(/\bcatch\s*\(([^)]*)\)/g);
  ['window', 'document', 'console', 'localStorage', 'navigator', 'firebase',
   'Date', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean',
   'Promise', 'Set', 'Map', 'React', 'URL', 'Blob', 'FileReader', 'Image',
   'setTimeout', 'setInterval', 'fetch', 'alert', 'confirm', 'performance',
   'CustomEvent', 'Event', 'Intl', 'crypto', 'atob', 'btoa', 'structuredClone',
  ].forEach((g) => declared.add(g));

  const offenders = [];
  for (const m of src.matchAll(/\s([a-zA-Z][\w]*)=\{([A-Za-z_$][\w$]*)\}/g)) {
    const [, prop, ident] = m;
    if (declared.has(ident)) continue;
    const line = src.slice(0, m.index).split('\n').length;
    offenders.push(`  line ${line}: ${prop}={${ident}} — ${ident} is never declared in this file`);
  }
  return [...new Set(offenders)];
}

export default { bareUserAboveDeclaration, memoReadingLaterConst, jsxPropsWithUndeclaredIdentifiers };
