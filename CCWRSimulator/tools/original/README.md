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

**It stalls.** Both renderers freeze on this 35MB movie — `isPlaying` stays
true while the clock stops. The 2D canvas renderer (needed for `__grab`) often
freezes on load; WebGL survives longer but cannot be read back, so captures
there have to come from a screenshot with `save_to_disk`. Verify the clock is
moving before trusting anything you observe.

The SWF is ~27MB and is deliberately not committed — regenerate it from the exe.
