// Every route that stops or restarts a head must be attributed.
//
// This shipped broken: the head-issue modal received `onHeadChange={handleHeadChange}`
// and its Offline/Active buttons wrote a status change straight through — no PIN
// asked, `statusBy` empty, and a head event logged with an empty name. A head
// could be taken off the line with nobody's name against it, which is the one
// question ("who turned this off?") the attribution exists to answer.
//
// The fix is a guard inside handleHeadChange itself rather than at each call
// site, because the call site that gets missed is precisely the one nobody
// thought to wrap. This test protects that guard: it is one line, it looks
// redundant beside the wrapped call sites, and it is the only thing standing
// between a new caller and a silent bypass.
//
// Checked as source text because the logic lives inside a React component whose
// rendering needs the whole Firebase environment, while the property asserted
// is a property of the source.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, 'Line.jsx'), 'utf8');

// The body of `const handleHeadChange = (...) => { … }`, up to the next
// top-level `const` in the component.
const bodyOf = (name) => {
  const start = src.indexOf(`const ${name} = (`);
  expect(start, `${name} not found in Line.jsx`).toBeGreaterThan(-1);
  const next = src.indexOf('\n  const ', start + 10);
  return src.slice(start, next === -1 ? src.length : next);
};

describe('head status attribution', () => {
  it('handleHeadChange refuses an unattributed status change', () => {
    const body = bodyOf('handleHeadChange');
    // Must test BOTH that it is a status change and that no name came with it,
    // and must route through `attributed` rather than just dropping the write.
    expect(body, 'the status/who guard is gone — a caller can now set head status with no PIN')
      .toMatch(/field === 'status'\s*&&\s*who === undefined/);
    expect(body, 'the guard no longer routes through attributed()')
      .toMatch(/attributed\(/);
  });

  it('updateHeadFields cannot smuggle a status through the multi-field path', () => {
    const body = bodyOf('updateHeadFields');
    expect(body, "updateHeadFields no longer intercepts `status` — it is a side door onto head status")
      .toMatch(/'status' in fields/);
    expect(body).toMatch(/handleHeadChange\(index, 'status'/);
  });

  it('quickToggleHead still runs inside attributed()', () => {
    expect(src).toMatch(/const quickToggleHead = \([^)]*\) => attributed\(/);
  });

  it('the head-issue modal is still wired to the guarded function', () => {
    // Wiring it to anything that writes status directly would reopen the hole.
    const mount = src.slice(src.indexOf('<HeadIssueModal'));
    expect(mount.slice(0, 900)).toMatch(/onHeadChange=\{handleHeadChange\}/);
  });
});
