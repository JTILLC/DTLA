# CCW Centerline

Builds the sheet that tells a customer what an Ishida CCW's settings **should
be** for a given product, so an operator can hold it against the live machine
and compare field by field.

It is a specification, not a record. Every page of the output says so, in a band
that is not configurable — a page of RCU screens showing values is otherwise
indistinguishable from a photograph of a running machine, and one of these pages
will eventually be found detached from the rest.

    npm install
    npm run dev      # http://localhost:5173
    npm test
    npm run build

## Getting values in

Four ways, because no single one covers a plant visit:

| | |
|---|---|
| **Type them** | Always works. The screen preview updates as you type. |
| **Import from the machine** | The `.csv` files the RCU's Output button writes, and `Preset.prm` from the backup's `cw` folder. Read, listed, and placed only where you place them — one value onto a mapped screen, or a whole block (AD parameter, hopper drive, a preset's timing or feeder table) as its own section. The text files hold the machine-level settings; the presets themselves are only in the binary. |
| **Write back to the machine** | With a backup's `Preset.prm` loaded and preset blocks on the document, *Write Preset.prm* builds a copy of that file with one preset replaced by the blocks as edited. Only fields whose place in the file is proven are written; the `?` ones keep the machine's values. Try an empty preset number first and read the screens back. |
| **Write a preset by hand** | The same preset blocks with every setting named and every value empty, for a machine that cannot be read. Pick the head and section count. |
| **Photograph a screen** | For any RCU whose artwork we do not hold — which is most newer units. Straightened, then optionally read by the screen reader. |
| **Copy a previous centerline** | Start from the last one for that customer and change what differs. |

## The two kinds of page

**Mapped screens** use stored artwork of a real RCU (a 14-head unit running
POTATO CHIPS at 90.0 g). The customer's values are painted into the machine's
own boxes, so the page looks like the screen the operator is about to see.
`src/data/rcuFields.json` holds where every value sits; see `data/rcu-fields.json`
in this repo for the same map with its provenance notes.

**Photographed screens** are for everything else. The photo is perspective-
corrected to a straight-on 4:3 image. This is the path for the newer RCU
generation (`RCU W0530G` and similar), whose artwork we have none of.

## Reading a screen

`POST /scan-rcu-screen` on the `ccw-media` Worker (`src/rcu.js` in
`CCWISSUESGitHub/media-worker`). The API key never reaches the browser; the
route is gated on a verified Firebase token and an origin allow-list, exactly
like `/scan-weights`.

Nothing it returns is authoritative. Values pre-fill a form for review, anything
it was unsure of is flagged `check`, and the engineer confirms before the
document goes out.

**Before deploying this app**, add its origin to `ALLOWED_ORIGIN` in the
Worker's `wrangler.toml` and redeploy, or every read will come back 403.
Sign-in is not wired up yet — the reader button stays disabled and everything
else works.

## Command-line tools

`tools/` holds the Python originals the browser code was ported from. They are
for working against a backup folder rather than a plant visit, and they are the
reference implementation — `parse_export.py` and `src/utils/rcuExport.js` have
the same rules and the same tests.

    python3 tools/parse_export.py <folder-of-exports>
    python3 tools/parse_preset.py <Preset.prm> [--json]
    python3 tools/screen_crop.py <photo> <out.png> [x,y x,y x,y x,y]
    python3 tools/overlay.py <screens-dir> <values.json> <outdir>

## The binary parameter files

Beside the text exports, a backup's `cw/` folder holds the RCU's own binary
store: `Preset.prm` and one small `.prm` per machine block (`ad`, `comb`,
`drive`, `section`, `fdfreq`, `intlock`…). The text exports cover the machine
blocks; the presets are only in the binary. `tools/parse_preset.py` reads it.

What is known, from one real file (a 32-head six-section mix weigher on an
RCU W0530G) checked against the preset printout example in the CCW-R-2**
instruction manual, whose defaults match the file's unused sections byte for
byte. Everything is big-endian.

- `Preset.prm` is 200 records of 2892 bytes; record *i* is preset *i+1*.
  `Preset2.prm` was all zeros.
- Name at `0x08`, product code at `0x21`; the section product names and codes
  from `0x978` in 48-byte slots; a modified timestamp (yy mm dd weekday 0 hh
  mm ss) at `0xb18`.
- Eight 16-byte section entries from `0xa4`: a 32-bit head mask (`0xffff` =
  none) then the timing table in 10 ms units (WH-PH, PH-RF, WH-BH, BH-WH, …).
- Two 292-byte feeder sets, current at `0x13c` and the "Write OptimumVal" copy
  at `0x320` (`0xffffffff` = never written): per-section AFD auto amp/time
  ranges, 32 RF amp/time pairs, 8 DF pairs, and per-DF infeed weight and
  limits.
- Eight 136-byte section blocks from `0x510`, then the whole-preset block at
  `0x950`. Target weight is a u16 in 0.1 g at `+0x0a`; the six section targets
  sum to the total in every real preset. Auto feed target, priority
  participation, feeder multiplier and good-efficiency limit follow.
- Not proven: which of the three u16s after the target is UPPER, TOL NEG ERR
  and EX.UPPER (the printout's order is assumed); speed, dump count, average
  control and section-set number in the total block; two per-head byte tables
  at `0x43`; the u16 at `0x38`. The tool marks all of these with `?`.
- `section.prm` is 32-bit head masks; `fdfreq.prm` is a period in
  microseconds and a signed offset in 0.1 Hz per feeder, which reproduces the
  Feed Frequency export exactly.

## Traps worth knowing

- **A value that does not fit wraps onto the line BELOW its label.** Attach
  wrapped lines to the label after them and every wrapped field lands one
  setting off (`ACTUATOR TYPE` reads `SLIT`, `DRIVE POWER` reads `STEPPING
  MOTOR`), each individually plausible. An earlier version of this README and
  parser had it the other way round, from a made-up example; the rule was
  corrected against a real output folder in September 2026. Tested in
  `rcuExport.test.js`.
- **Export sub-blocks reuse key names, at two levels.** `PH` and `WH` both
  carry `STOP DELAY PLS` and each has its own `DRIVE PATTERN`; the four
  `INTLK PARM NO.` sets each carry a `DTH1` and `DTH2`. Flattened, one silently
  overwrites the other. The first sub-heading style in a file (`== ==` or
  `-- --`) is its top level; the other style nests beneath it.
- **Not every file is settings.** `Netmap` is a node grid and reads as empty;
  `Rom` is the board list (kept, because the `RCU` line says which generation
  the machine is); `Afv` and `Freq` are per-head calibration.
- **Export filenames pad to seven characters** then append a timestamp
  (`Afv____240730142241.csv`, `Section240730142308.csv`). Splitting on `_` works
  for the first and fails silently on the second.
- **Corner detection is a suggestion, never a decision.** A corner out by a few
  percent skews every value on the page, so the handles are always shown.
- **iPhone HEIC** does not decode in a browser canvas. The app says so rather
  than showing an empty frame; the CLI tool shells out to `sips`.

## Where the artwork came from

Extracted from `IshidaVR.exe`, a Flash Player 7 projector, by
`CCWRSimulator/tools/extract_swf.py`. The originals live in
`../CCWRSimulator/assets/screens`; `public/screens` holds the five this app
overlays.
