import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import navmap from './navmap.json';
import screenInfo from './screenInfo';
import { allEdges, reachable, canReach } from '../utils/navGraph';

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
      const drawer =
        navmap.machineSet.screens.includes(slug) ||
        navmap.machineSet.drawTabOn.includes(slug);
      expect(
        s.hotspots.length + (drawer ? 1 : 0),
        `${slug} has no exits`
      ).toBeGreaterThan(0);
    }
  });

  it('machine set drawer items and screens are all real', () => {
    const ms = navmap.machineSet;
    for (const item of ms.items) {
      expect(navmap.screens[item.to], `drawer -> ${item.to}`).toBeDefined();
    }
    for (const s of [...ms.screens, ...ms.drawTabOn]) {
      expect(navmap.screens[s], `drawer on ${s}`).toBeDefined();
    }
    expect(ms.items.length).toBe(7);
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
    const drawerScreens =
      navmap.machineSet.screens.length + navmap.machineSet.drawTabOn.length;
    expect(allEdges(navmap).length).toBe(
      hotspotCount + drawerScreens * navmap.machineSet.items.length
    );
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

  it('manual-sourced notes cite a manual section; observed notes carry the caution', () => {
    for (const [slug, info] of Object.entries(screenInfo)) {
      if (info.source === 'manual') {
        expect(info.ref, `${slug} manual-sourced but no ref`).toBeTruthy();
      } else {
        expect(info.source, `${slug} bad source`).toBe('observed');
        expect(info.note, `${slug} observed but no caution note`).toBeTruthy();
      }
    }
  });
});
