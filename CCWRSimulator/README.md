# CCW-R RCU Simulator

A clickable training simulator for the Ishida CCW-R multihead weigher's
Remote Control Unit (RCU) touchscreen. Trainees can free-explore the real
menu tree or follow guided lessons taken from the Operation Manual — no
machine required. Built for iPad-in-landscape first; works on anything.

React 19 + Vite + Tailwind, same stack as the rest of the fleet.

## Run it

```sh
npm install
npm run dev        # local dev server
npm test           # data integrity tests (vitest)
npm run build      # production build in dist/
```

Deploy `dist/` to Cloudflare Pages as usual (`public/_redirects` carries the
SPA fallback).

## Where the art came from

Every screen is a real RCU screenshot extracted from Ishida's own Flash
demonstrator, `IshidaVR.exe` (a Flash Player 7 projector found at
`/Users/jti/Documents/BRB/Simulators/IshidaRScreens/IshidaVR.exe`). The
captured machine is a 14-head CCW-R running preset C1 "POTATO CHIPS",
90.0 g target at 80 wpm — those values are baked into the JPEGs and cannot
change.

- `assets/screens/` — the 55 extracted 800x600 screens, untouched. This is
  the clean source; keep it.
- `assets/sprites/` — 238 smaller extracted images (button glyphs, popups).
  Three of them are full screens the frame-walker missed (`0035` = Main
  Menu, `1386` = Various/FD Spec, `1401` = Various/H DRV Spec).
- `assets/screens.json` — frame → slug manifest from the extraction.
- `public/screens/` — byte-identical copies served by the app (the three
  sprite-pool screens renamed to their slugs). ~16 MB total, but the app
  only loads the current screen (~280 KB) and prefetches the screens one
  tap away, so nothing heavy ever blocks.

### Re-extracting

```sh
python3 tools/extract_swf.py <IshidaVR.exe> assets            # screens + sprites
python3 tools/extract_swf.py nav <IshidaVR.exe> nav_raw.json  # button geometry + actions
python3 tools/build_navmap.py nav_raw.json                    # writes src/data/navmap.json
                                                              # and fills public/screens/
```

## What is real and what is reconstructed

**Real (extracted from the SWF):** the navigation map. The movie's 661
`DefineButton2` tags carry hit-area shapes and `gotoAndStop` ActionScript;
`extract_swf.py nav` parses the button records, composes the placement
matrices, and resolves the goto labels against the frame manifest. That
yields 355 hotspots across 58 screens — real geometry, real wiring, then
verified by rendering every hotspot over its screenshot and eyeballing a
sample. Buttons whose actions are dynamic (numeric entry, toggles,
sprite-local view switches) don't navigate and are deliberately left out.

**Reconstructed (and labelled as such in the app):** the Machine Set
pop-up menu. The key itself is real — Operation Manual 6.4, Table 6-6,
key #8 — and its tab is baked into the art on exactly the 31 engineering
screens (verified by pixel-comparing the tab region across all 58). But
the menu's item list is data-driven ActionScript that static extraction
can't recover, so the drawer is drawn by the app: one entry per screen
family the movie contains, labelled with the header each family shows in
its own art, ordered as the families sit on the movie's timeline. The
drawer says "menu reconstructed" on its face. The Main Menu's capture
lacks the tab, so a look-alike tab is drawn there.

**Not wired:** the Select Total pop-up (left edge of the Main Menu — its
menus were not captured as frames), preset tiles/rows (loading a preset is
dynamic), Power/Stop/Start state changes, ten-key and keyboard popups, and
the two frames dropped on purpose: `total-select` (the Main Menu with its
drawer open) and `reset` (the projector's reboot animation).

## Training content

`src/data/screenInfo.js` holds per-screen notes. Every entry declares its
provenance:

- `source: 'manual'` — drawn from the CCW R Operation Manual
  (`reference/operation-manual.txt`, full text of the 166-page PDF), with
  the section cited so a trainee can read further.
- `source: 'observed'` — the screen is an engineering screen the Operation
  Manual does not cover; the text describes only what is visible, and the
  app shows a caution telling trainees to consult the Technical Manual.

`src/data/lessons.js` holds the guided lessons — all four follow real
manual procedures (zero adjustment 4.4.6, preset selection + production
start 4.4.5/4.4.7, target weight 6.10.4, draining 4.4.9). Lessons are
declarative data; progress is saved to localStorage and always resumable —
leaving a lesson never loses your place.

## Tests

`npm test` checks the things that must never regress:

- every hotspot targets a screen that exists, inside the 800x600 canvas
- every screen is reachable from the Main Menu, and every screen can get
  back to it (no dead ends)
- every screen ships its image and has training notes; observed-only notes
  carry the caution
- every lesson walks real hotspots in a consistent screen order, starts
  and ends on the Main Menu, and its highlights land on the right keys
