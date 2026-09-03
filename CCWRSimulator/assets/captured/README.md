# Captured screens — NOT extracted originals

Everything in `../screens` was lifted straight out of the Flash movie and is
pixel-identical to what the machine drew. **These are not.**

These eight screens are composed at runtime — the Select Total views are drawn
over the Main Menu, and the access-level dialogs are pop-ups — so no bitmap for
them exists inside the movie to extract. The only way to get artwork was to run
the original under Ruffle and photograph it.

That means they carry Ruffle's rendering, not Flash's. It is close but not the
same: Ruffle renders some fills and glyph edges differently (the bottom-bar HOME
label is the most obvious). Judge them as a faithful record of the LAYOUT and
CONTENT, not of the exact pixels.

Captured 2026-09-02 with `tools/original/serve.py` + `window.__grab()`, at the
canvas's own 1439x1079 backing store and downsampled to 800x600 with Lanczos —
supersampling, so sharper than a 1:1 render would have been. The PNGs here are
the raw grabs; `public/screens/*.jpg` are what the app serves.

If a genuine capture of any of these ever turns up, replace it and delete the
corresponding file here.

## 2026-09-02: the fine-tooth-comb pass

`public/captured/` holds 160-odd further captures — every pop-up, drawer,
chart mode, wizard step and lock state the program has — taken the same way
at Maintenance level with power on, and served from there (revalidating, not
immutable, since they get recaptured). `public/captured/manifest.json` maps
each name to its file and folds exact duplicates. `tools/build_states.py`
turns them into the `parent@state` screens in the map, and
`reference/flash-structure.md` says what each one is.
