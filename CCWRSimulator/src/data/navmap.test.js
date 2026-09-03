import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import navmap from './navmap.json';
import screenInfo from './screenInfo';
import { allEdges, drawers, drawerScreens, reachable, canReach } from '../utils/navGraph';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const slugs = Object.keys(navmap.screens);

describe('navigation map integrity', () => {
  it('has a main menu and a sensible number of screens', () => {
    expect(navmap.screens['main-menu']).toBeDefined();
    expect(slugs.length).toBeGreaterThanOrEqual(58);
  });

  it('every hotspot points at a screen that exists', () => {
    for (const [slug, s] of Object.entries(navmap.screens)) {
      for (const h of s.hotspots) {
        // A lamp toggle or a keypad digit navigates nowhere, and says what it
        // does instead. Anything else must go somewhere real.
        if (!h.to) {
          expect(h.action || h.toggles || h.sets, `${slug}: a key that does nothing`).toBeTruthy();
          continue;
        }
        expect(navmap.screens[h.to], `${slug} -> ${h.to}`).toBeDefined();
      }
      if (s.autoNext) expect(navmap.screens[s.autoNext.to], `${slug} autoNext`).toBeDefined();
      if (s.onEnter) expect(navmap.screens[s.onEnter], `${slug} onEnter`).toBeDefined();
    }
  });

  it('no hotspot is a self-loop', () => {
    for (const [slug, s] of Object.entries(navmap.screens)) {
      for (const h of s.hotspots) {
        if (h.to) expect(h.to, `${slug} loops to itself`).not.toBe(slug);
      }
    }
  });

  it('every state screen names its parent, and the parent is a real screen', () => {
    // States (`run-feeder@bar`) are the program's pop-ups, modes, wizard steps
    // and locks — sprites and script rather than frames — and every one of
    // them belongs to the frame it is drawn over.
    for (const [slug, s] of Object.entries(navmap.screens)) {
      if (!slug.includes('@')) continue;
      expect(s.parent, `${slug} has no parent`).toBeTruthy();
      expect(navmap.screens[s.parent], `${slug} parent ${s.parent}`).toBeDefined();
      expect(s.parent.includes('@'), `${slug} parent is itself a state`).toBe(false);
      expect(['popup', 'state', 'wizard']).toContain(s.kind);
      expect(s.captured, `${slug} is a capture`).toBe(true);
      expect(slug.startsWith(s.parent + '@'), `${slug} is named for its parent`).toBe(true);
    }
  });

  it('every hotspot rect sits inside the 800x600 canvas with real size', () => {
    const { w, h } = navmap.canvas;
    for (const [slug, s] of Object.entries(navmap.screens)) {
      for (const spot of s.hotspots) {
        expect(spot.x, `${slug} x`).toBeGreaterThanOrEqual(0);
        expect(spot.y, `${slug} y`).toBeGreaterThanOrEqual(0);
        expect(spot.x + spot.w, `${slug} right edge`).toBeLessThanOrEqual(w);
        expect(spot.y + spot.h, `${slug} bottom edge`).toBeLessThanOrEqual(h);
        expect(spot.w, `${slug} width`).toBeGreaterThanOrEqual(4);
        expect(spot.h, `${slug} height`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('a confirmation dialog\'s Yes and No sit on its buttons, not beside them', () => {
    // The Read Default dialog had its Yes/No rects out at x=533/683 — the
    // blank right half of the panel and the wall beyond it — so neither key
    // did anything and the screen could not be left. Measured off the four
    // captures that share this panel: Yes 283..373, No 433..523, y 393..463.
    for (const slug of ['preset-feeder@read-default', 'display-preset@initialize',
      'display-all-edit@initialize', 'panel-screen-control@tune-up']) {
      const spots = navmap.screens[slug].hotspots;
      const yes = spots.find((h) => h.label === 'Yes');
      const no = spots.find((h) => h.label === 'No');
      expect(yes, `${slug} Yes`).toMatchObject({ x: 283, y: 393, w: 90, h: 70 });
      expect(no, `${slug} No`).toMatchObject({ x: 433, y: 393, w: 90, h: 70 });
    }
    expect(navmap.screens['preset-feeder@read-default'].hotspots
      .find((h) => h.label === 'Yes').action).toBe('read-default');
  });

  it('the H DRV Parameter drop-down covers every unit page, and its header is on the canvas', () => {
    const hp = navmap.hdrvParameter;
    expect(hp.screens).toContain('various-hdrv');
    for (const slug of hp.screens) {
      expect(navmap.screens[slug], slug).toBeDefined();
      expect(hp.units[slug], `${slug} unit name`).toBeTruthy();
    }
    expect(hp.header.x + hp.header.w).toBeLessThanOrEqual(navmap.canvas.w);
    expect(hp.options.map((o) => o.no)).toEqual([1, 2, 3]);
  });

  it('the DF Weight Setting keypad hangs off Target Wt on both Feeder Adjust screens', () => {
    for (const [parent, popup] of [['preset-feeder', 'preset-feeder@df-target-wt'],
      ['run-feeder', 'run-feeder@df-target-wt']]) {
      const key = navmap.screens[parent].hotspots.find((h) => h.to === popup);
      expect(key, `${parent} Target Wt`).toBeDefined();
      expect(key.dfOnly, 'the key exists only with DF picked').toBe(true);
      const kp = navmap.screens[popup];
      expect(kp.keypad.seedFrom).toBe('dfTargetWt');
      expect(kp.keypad).toMatchObject({ min: 1, max: 9999 });
      const enter = kp.hotspots.find((h) => h.action === 'enter');
      expect(enter).toMatchObject({ to: parent, commit: 'dfTargetWt' });
      expect(kp.hotspots.find((h) => h.action === 'cancel').to).toBe(parent);
      // Ten digits and no decimal point: the keypad's "." key is blank.
      expect(kp.hotspots.filter((h) => h.action === 'key').map((h) => h.char).sort())
        .toEqual(['-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    }
    expect(navmap.feederAdjust.dfTargetWt).toMatchObject({ default: 500, min: 1, max: 9999 });
    for (const k of Object.values(navmap.feederAdjust.screens['run-feeder'].dfKeys)) {
      expect(fs.existsSync(path.join(root, 'public', k.image)), k.image).toBe(true);
    }
  });

  it('every screen is reachable from the main menu', () => {
    const seen = reachable(navmap, 'main-menu');
    const missing = slugs.filter((s) => !seen.has(s));
    expect(missing, `unreachable: ${missing.join(', ')}`).toEqual([]);
  });

  it('no dead ends: every screen can get back to the main menu', () => {
    const seen = canReach(navmap, 'main-menu');
    const stuck = slugs.filter((s) => !seen.has(s));
    expect(stuck, `dead ends: ${stuck.join(', ')}`).toEqual([]);
  });

  it('every screen has at least one way out', () => {
    for (const [slug, s] of Object.entries(navmap.screens)) {
      const drawer = drawers(navmap).some((d) => drawerScreens(d).includes(slug));
      const exits = s.hotspots.filter((h) => h.to).length + (drawer ? 1 : 0) + (s.autoNext ? 1 : 0);
      expect(exits, `${slug} has no exits`).toBeGreaterThan(0);
    }
  });

  it('machine set drawer items and screens are all real', () => {
    const ms = navmap.machineSet;
    for (const item of ms.items) {
      if (item.to === null) continue;   // deliberately uncaptured; see below
      expect(navmap.screens[item.to], `drawer -> ${item.to}`).toBeDefined();
    }
    for (const s of [...ms.screens, ...ms.drawTabOn]) {
      expect(navmap.screens[s], `drawer on ${s}`).toBeDefined();
    }
    // Eight on the real unit at Maintenance level (Service Manual 4.4, p4-18).
    expect(ms.items.length).toBe(8);
  });

  it('select total drawer items and screens are all real', () => {
    const st = navmap.selectTotal;
    expect(st).toBeDefined();
    for (const item of st.items) {
      expect(navmap.screens[item.to], `drawer -> ${item.to}`).toBeDefined();
    }
    for (const s of drawerScreens(st)) {
      expect(navmap.screens[s], `drawer on ${s}`).toBeDefined();
    }
    // Six total views, in the order of Operation Manual Table 6-32 (6.11).
    expect(st.items.map((i) => i.to)).toEqual([
      'total-current',
      'total-xbar',
      'total-transitional',
      'total-participation',
      'total-setting',
      'total-operation-log',
    ]);
    // The tab is baked into the Main Menu capture and every Total capture —
    // checked against the artwork — and nowhere else on the map.
    expect(drawerScreens(st).sort()).toEqual(
      ['main-menu', ...st.items.map((i) => i.to)].sort()
    );
  });

  it('the Machine Set tab is on the main menu', () => {
    // It was, then a correction that added the engineering and Control Panel
    // screens REPLACED the list instead of extending it, and the one screen the
    // tab was known to be on lost it. The drawer then appeared on Control Panel
    // and vanished on returning home. Service Manual 4.4's figure (page 4-18)
    // shows the drawer open on the Main Menu.
    const ms = navmap.machineSet;
    const carriers = new Set([...ms.screens, ...ms.drawTabOn]);
    expect(carriers.has('main-menu')).toBe(true);
  });

  it('a drawer item we cannot open says why', () => {
    // Weigher Information is real and Maintenance-level only, and we hold no
    // artwork for it. Listing it silently would teach a menu that is missing an
    // item; dropping it would do the same. It is listed, disabled, and explains
    // itself — and that explanation is not optional.
    for (const drawer of drawers(navmap)) {
      for (const item of drawer.items) {
        if (item.to !== null && item.to !== undefined) continue;
        expect(item.note, `${item.label} has no note`).toBeTruthy();
        expect(item.note.length, `${item.label} note is too thin`).toBeGreaterThan(30);
      }
    }
  });

  it('captured screens are marked as captures, extracted screens are not', () => {
    // Eight base screens are Ruffle captures of the running program, not
    // bitmaps extracted from the movie (assets/captured/README.md), and so is
    // every state. The flag keeps that provenance in the data itself.
    const captured = slugs.filter((s) => navmap.screens[s].captured && !s.includes('@'));
    expect(captured.sort()).toEqual([
      'level-password',
      'level-select',
      'total-current',
      'total-operation-log',
      'total-participation',
      'total-setting',
      'total-transitional',
      'total-xbar',
    ]);
    // Every extracted screen carries the SWF frame it came from; a capture
    // has no frame to point at and must not claim one.
    for (const slug of slugs) {
      const s = navmap.screens[slug];
      if (s.captured) expect(s.frame, `${slug} claims a frame`).toBeUndefined();
      else expect(s.frame, `${slug} missing frame`).toBeGreaterThan(0);
    }
  });

  it('every screen ships its background image, and every variant of it', () => {
    for (const [slug, s] of Object.entries(navmap.screens)) {
      const images = [s.image, ...Object.values(s.imageBy || {}),
        ...(s.layers || []).map((l) => l.image)];
      for (const image of images) {
        const file = path.join(root, 'public', image);
        expect(fs.existsSync(file), `${slug} missing ${image}`).toBe(true);
      }
    }
  });

  it('the Power key rect exists and sits on the bottom bar', () => {
    const pk = navmap.powerKey;
    expect(pk).toBeDefined();
    // Measured off the artwork: frame x504-592, same row as HOME (y529)
    // and Start (y528). If this drifts, the drawn Power key stops lining
    // up with the baked-in art on every screen.
    expect(pk.x).toBeGreaterThan(450);
    expect(pk.x + pk.w).toBeLessThan(650);
    expect(pk.y).toBeGreaterThan(500);
    expect(pk.y + pk.h).toBeLessThanOrEqual(navmap.canvas.h);
  });

  it('power gating covers exactly the keys the original gates', () => {
    // Observed on the running original (2026-09-02): the ONLY navigating
    // keys that are dimmed and dead with control power off are the
    // bottom-bar Start keys — on the Main Menu (the SWF hit rect at
    // 702,528 IS the Start key) and on Select Preset, both verified by
    // pressing them cold (nothing) and powered (Production starts).
    // Everything else that navigates — Zero Adjst, Drain, Full Open,
    // Select Preset, Exit, HOME, tabs, drawers — works with power off.
    // Extend this list only from observation, never from inference.
    const gated = [];
    for (const [slug, s] of Object.entries(navmap.screens)) {
      for (const h of s.hotspots) {
        if (h.requiresPower) gated.push(`${slug} -> ${h.to}`);
      }
    }
    expect(gated.sort()).toEqual([
      'main-menu -> run-combination',
      'preset-select-a -> run-combination',
    ]);
    // The states found on the fine-tooth-comb pass gate on power the same way,
    // through `requires`: Drain START, Full Open's Open, Test Drive's Drive
    // Start, and the wizard's final START. All pressed cold and seen dead.
    const also = [];
    for (const [slug, s] of Object.entries(navmap.screens)) {
      for (const h of s.hotspots) {
        if ((h.requires || []).includes('power')) also.push(`${slug} -> ${h.to || h.label}`);
      }
    }
    expect(also.sort()).toEqual([
      'assistant@standby -> run-combination',
      'discharge-feeder -> Drain START',
      'discharge-timing -> Drain START',
      'discharge-weight -> Drain START',
      'hopper-discharge -> hopper-discharge@open',
      'selfdiag-test -> selfdiag-test@drive',
      'zero-adjust -> zero-adjust@starting',
    ]);
  });

  it('with power off, only the Production screens become unreachable', () => {
    // The real machine: Production exists only while running, and running
    // needs power. Every other screen must stay reachable on a cold
    // machine — if gating a hotspot ever strands anything else, that is a
    // bug in the gating, not a fact about the machine.
    const cold = JSON.parse(JSON.stringify(navmap));
    for (const s of Object.values(cold.screens)) {
      s.hotspots = s.hotspots.filter((h) => !h.requiresPower && !(h.requires || []).includes('power'));
    }
    const seen = reachable(cold, 'main-menu');
    const dark = slugs.filter((s) => !seen.has(s)).sort();
    // The five Production tabs and every state under them, plus the two
    // states whose only door is a power-gated key.
    const expected = slugs.filter((s) => s.startsWith('run-')
      || s === 'hopper-discharge@open' || s === 'selfdiag-test@drive'
      || s === 'zero-adjust@starting').sort();
    expect(dark).toEqual(expected);
  });

  it('edge list matches hotspot count plus drawer wiring', () => {
    const hotspotCount = slugs.reduce(
      (n, s) => n + navmap.screens[s].hotspots.filter((h) => h.to).length
        + (navmap.screens[s].autoNext ? 1 : 0) + (navmap.screens[s].onEnter ? 1 : 0),
      0
    );
    // screens and drawTabOn overlap, so each drawer's screens are counted
    // once; and only the items that actually open a screen contribute edges.
    const drawerEdges = drawers(navmap).reduce(
      (n, d) =>
        n + drawerScreens(d).length * d.items.filter((i) => i.to).length,
      0
    );
    expect(allEdges(navmap).length).toBe(hotspotCount + drawerEdges);
  });
});

describe('training content coverage', () => {
  it('every screen has training notes', () => {
    // A state reads its parent's notes; it needs none of its own.
    const missing = slugs.filter((s) => !screenInfo[s] && !screenInfo[navmap.screens[s].parent]);
    expect(missing, `no screenInfo for: ${missing.join(', ')}`).toEqual([]);
  });

  it('no training notes for screens that do not exist', () => {
    const orphans = Object.keys(screenInfo).filter((s) => !navmap.screens[s]);
    expect(orphans, `orphan screenInfo: ${orphans.join(', ')}`).toEqual([]);
  });

  it('manual/service notes cite their section; observed notes carry the caution', () => {
    for (const [slug, info] of Object.entries(screenInfo)) {
      if (info.source === 'manual') {
        expect(info.ref, `${slug} manual-sourced but no ref`).toBeTruthy();
      } else if (info.source === 'service') {
        // Service Manual refs must be unmistakable: 'Service <section> …'
        expect(info.ref, `${slug} service-sourced but no Service ref`).toMatch(
          /^Service \d/
        );
        expect(
          info.note,
          `${slug} service screen but no engineering note`
        ).toBeTruthy();
      } else {
        expect(info.source, `${slug} bad source`).toBe('observed');
        expect(info.ref, `${slug} observed must not claim a ref`).toBeNull();
        expect(info.note, `${slug} observed but no caution note`).toBeTruthy();
      }
    }
  });
});

describe('Exit', () => {
  // Every screen that shows an Exit key needs it wired. On the five Production
  // tabs it was not, so pressing Exit did nothing at all — and Production is
  // where a trainee spends most of their time. The key sits at the same place
  // on every screen that has one.
  const EXIT = { x: 723, y: 472 };
  const PRODUCTION = ['run-combination', 'run-feeder', 'run-timing',
    'run-totals', 'run-weight'];

  it.each(PRODUCTION)('%s has a working Exit', (slug) => {
    const hit = navmap.screens[slug].hotspots.find(
      (h) => EXIT.x >= h.x && EXIT.x <= h.x + h.w
          && EXIT.y >= h.y && EXIT.y <= h.y + h.h
    );
    expect(hit).toBeDefined();
    expect(hit.to).toBe('main-menu');
  });
});
