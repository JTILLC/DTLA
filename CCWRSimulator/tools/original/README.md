# Running the original

`IshidaVR.exe` is a Windows Flash Player 7 projector, so it does not run on a
Mac and no agent here can drive a native desktop app anyway. What it *can* do is
run the movie inside it.

    # 1. extract the SWF (also writes screens/ and sprites/)
    python3 tools/extract_swf.py \
      "/Users/jti/Documents/BRB/Simulators/IshidaRScreens/IshidaVR.exe" \
      /tmp/ishida-vr

    # 2. put the movie beside this harness and serve it
    cp /tmp/ishida-vr/IshidaVR.swf tools/original/
    cd tools/original && npm install && python3 -m http.server 8899

    # 3. open http://localhost:8899/

Ruffle plays it. The original is then clickable, with its live clock running —
which is how you tell it apart from our static screenshots.

## What this is good for, and what it is not

**Good for behaviour.** Which key leads to which screen, what is reachable, what
a popup does. This is the ground truth to check `src/data/navmap.json` against,
and it is the only way to see the parts of the movie that static extraction
cannot reach — the Machine Set drawer's real contents, for one.

**Not good for pixel-exactness.** Ruffle is a reimplementation and its
rendering is close but not identical, so never "correct" one of our extracted
screenshots to match it.

**But do not mistake a state for a rendering difference.** The Zero Adjustment
hoppers come out blue here and grey in our extracted screen, and that was
written up as a Ruffle artefact. It is not: **blue means SELECTED**, the menu
opens with every weigh hopper selected, and our extracted art is simply the
deselected state. Check whether a difference is the machine doing something
before blaming the emulator.

**It does NOT stall — that was a misdiagnosis.** Two false liveness signals
cost hours here, and both look convincing:

- **The RCU clock is stamped once at startup, not ticked.** The movie reads
  `Date`/`getHours` in a DoAction block when it loads and never updates it. A
  clock reading the same value ten minutes later means nothing. (Proof: the
  clock matches `performance.timeOrigin`, not the current time.)
- **An unchanging canvas means an unchanging screen.** Comparing
  `toDataURL().length` over a few seconds "detects" a freeze on any static
  menu, which is most of them.

Judge liveness by pressing something and seeing the screen change, or by
watching the live weight on the Production screen — that really does update.

**The real trap is coordinates.** The `computer` tool works in SCREENSHOT space,
which is a fixed 1568px wide, while the page is whatever the window is. Convert
with `1568 / window.innerWidth`, on top of the stage offset — `window.__at()`
does both. Get it wrong and clicks land beside the button, nothing happens, and
it looks exactly like a frozen movie.

    const c = window.__player.shadowRoot.querySelector('canvas');
    const b = c.getBoundingClientRect();
    const f = 1568 / window.innerWidth;
    window.__at = (x, y) => ({
      x: Math.round((b.x + x * (b.width / 800)) * f),
      y: Math.round((b.y + y * (b.height / 600)) * f),
    });

Re-measure after any window resize; the factor changes.

## Capturing

`__grab(name)` posts the 1439x1079 canvas to `serve.py`, which writes
`captures/<name>.png`. It came back BLANK for a long time: Ruffle ignores
`preferredRenderer: 'canvas'` here and takes WebGL, whose buffer cannot be
read back after the frame is presented. `index.html` now intercepts
`getContext` before ruffle.js loads and adds `preserveDrawingBuffer: true`,
and the grab works. Two things to know about it:

- The buffer holds the LAST DRAWN frame. A pop-up that has just closed can
  still be in it if nothing has repainted since; grab after something moves.
- `tools/process_captures.py` turns the PNGs into the 800x600 JPEGs the app
  serves (`public/captured/`) and folds exact duplicates.

## Driving it

Synthetic events do nothing — Ruffle wants trusted pointer events — so
clicks go through the `computer` tool, batched with `browser_batch`
(dozens of clicks and grabs in one call). Convert movie coordinates to
screenshot coordinates with `sx = mx * f`, `sy = (27.5 + my) * f`,
`f = 1568 / window.innerWidth` (the 27.5 is the status bar above the
stage). The first click after a load only focuses the player.

Get the machine into the right state first or you will miss half of it:
**Power on** (HOME then Power, wait ~12 s) and **Maintenance level** (key
icon > Maintenance > 1 2 3 > Enter). Then keep three things in mind:

- The Machine Set drawer toggles and its state persists across screens.
- A pop-up disables every other key until it is closed; close it with its
  own Cancel/No, not HOME.
- WH Span Adjustment on Manual Adjustment is a dead end (SPAN ERROR);
  reload the page to get out.
