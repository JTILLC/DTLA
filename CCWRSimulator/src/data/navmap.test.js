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
        expect(navmap.screens[h.to], `${slug} -> ${h.to}`).toBeDefined();
      }
    }
  });

  it('no hotspot is a self-loop', () => {
    for (const [slug, s] of Object.entries(navmap.screens)) {
      for (const h of s.hotspots) {
        expect(h.to, `${slug} loops to itself`).not.toBe(slug);
      }
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
      expect(
        s.hotspots.length + (drawer ? 1 : 0),
        `${slug} has no exits`
      ).toBeGreaterThan(0);
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
    // Eight screens are Ruffle captures of the running program, not bitmaps
    // extracted from the movie (assets/captured/README.md). The flag keeps
    // that provenance in the data itself.
    const captured = slugs.filter((s) => navmap.screens[s].captured);
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

  it('every screen ships its background image', () => {
    for (const [slug, s] of Object.entries(navmap.screens)) {
      const file = path.join(root, 'public', s.image);
      expect(fs.existsSync(file), `${slug} missing ${s.image}`).toBe(true);
    }
  });

  it('edge list matches hotspot count plus drawer wiring', () => {
    const hotspotCount = slugs.reduce(
      (n, s) => n + navmap.screens[s].hotspots.length,
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
    const missing = slugs.filter((s) => !screenInfo[s]);
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
