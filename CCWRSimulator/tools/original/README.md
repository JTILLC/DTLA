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

**Not good for appearance.** Ruffle is a reimplementation and does not render
identically: the Zero Adjustment hoppers come out blue here and grey in the real
thing. Our simulator's screens are the original JPEGs lifted straight out of the
movie, so on looks they are MORE accurate than this harness. Never "correct" a
screenshot to match Ruffle.

The SWF is ~27MB and is deliberately not committed — regenerate it from the exe.
