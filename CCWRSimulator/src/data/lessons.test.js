import { describe, it, expect } from 'vitest';
import navmap from './navmap.json';
import lessons from './lessons';
import { pointInRect } from '../utils/navGraph';

describe('lessons are walkable on the real navigation map', () => {
  for (const lesson of lessons) {
    describe(lesson.id, () => {
      it('names a manual reference and has steps', () => {
        expect(lesson.ref).toBeTruthy();
        expect(lesson.steps.length).toBeGreaterThan(0);
      });

      it('starts on the main menu', () => {
        expect(lesson.steps[0].screen).toBe('main-menu');
      });

      it('ends back on the main menu (never dead-ends the trainee)', () => {
        const last = lesson.steps[lesson.steps.length - 1];
        expect(last.kind).toBe('tap-nav');
        expect(last.to).toBe('main-menu');
      });

      it('every step kind is one the engine implements', () => {
        for (const step of lesson.steps) {
          expect(['read', 'tap-nav', 'tap-spot', 'tap-power']).toContain(step.kind);
        }
      });

      it('every step happens on a real screen', () => {
        for (const step of lesson.steps) {
          expect(navmap.screens[step.screen], `${step.screen}`).toBeDefined();
        }
      });

      it('screens flow: each step continues where the previous one left off', () => {
        let current = lesson.steps[0].screen;
        for (const [i, step] of lesson.steps.entries()) {
          expect(step.screen, `step ${i + 1} jumps screens`).toBe(current);
          if (step.kind === 'tap-nav') current = step.to;
        }
      });

      it('tap-nav steps use a hotspot that really exists (and via hits it)', () => {
        for (const [i, step] of lesson.steps.entries()) {
          if (step.kind !== 'tap-nav') continue;
          const spots = navmap.screens[step.screen].hotspots.filter(
            (h) => h.to === step.to
          );
          expect(spots.length, `step ${i + 1}: no hotspot ${step.screen} -> ${step.to}`)
            .toBeGreaterThan(0);
          if (step.via) {
            const hit = spots.some((h) => pointInRect(step.via, h));
            expect(hit, `step ${i + 1}: via point misses every ${step.to} hotspot`)
              .toBe(true);
          }
        }
      });

      it('tap-spot rects sit inside the canvas', () => {
        const { w, h } = navmap.canvas;
        for (const step of lesson.steps) {
          if (step.kind !== 'tap-spot') continue;
          expect(step.label).toBeTruthy();
          expect(step.rect.x).toBeGreaterThanOrEqual(0);
          expect(step.rect.y).toBeGreaterThanOrEqual(0);
          expect(step.rect.x + step.rect.w).toBeLessThanOrEqual(w);
          expect(step.rect.y + step.rect.h).toBeLessThanOrEqual(h);
        }
      });

      it('tap-spot rects do not cover a navigation hotspot (the tap must not need to navigate)', () => {
        for (const step of lesson.steps) {
          if (step.kind !== 'tap-spot') continue;
          const center = {
            x: step.rect.x + step.rect.w / 2,
            y: step.rect.y + step.rect.h / 2,
          };
          const clash = navmap.screens[step.screen].hotspots.find((h) =>
            pointInRect(center, h)
          );
          expect(clash, `${step.label} overlaps hotspot to ${clash?.to}`).toBeUndefined();
        }
      });

      it('every step has an instruction', () => {
        for (const step of lesson.steps) {
          expect(step.instruction, `${lesson.id} step missing instruction`).toBeTruthy();
        }
      });

      it('power comes before any power-gated key (the machine’s order, not a suggestion)', () => {
        // A lesson that walks a hotspot marked requiresPower without first
        // pressing Power teaches a procedure that does not work on the
        // machine: with power off those keys are dimmed and dead
        // (observed on the running original). The Power step must come
        // earlier in the same lesson.
        let powered = false;
        for (const [i, step] of lesson.steps.entries()) {
          if (step.kind === 'tap-power') powered = true;
          if (step.kind !== 'tap-nav') continue;
          const gated = navmap.screens[step.screen].hotspots.some(
            (h) => h.to === step.to &&
              h.requiresPower &&
              (!step.via || pointInRect(step.via, h))
          );
          if (gated) {
            expect(
              powered,
              `${lesson.id} step ${i + 1} presses a power-gated key before any Power step`
            ).toBe(true);
          }
        }
      });

      it('tap-power steps explain what the key does', () => {
        for (const step of lesson.steps) {
          if (step.kind !== 'tap-power') continue;
          expect(step.explain, `${lesson.id}: tap-power step without explain`).toBeTruthy();
          expect(step.explain.length).toBeGreaterThan(40);
        }
      });
    });
  }
});
