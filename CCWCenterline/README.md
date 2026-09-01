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
| **Import from the machine** | The `.csv` files the RCU's Output button writes. Read, listed, and placed only where you place them. |
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
    python3 tools/screen_crop.py <photo> <out.png> [x,y x,y x,y x,y]
    python3 tools/overlay.py <screens-dir> <values.json> <outdir>

## Traps worth knowing

- **The RCU prints a value ABOVE its label.** Both in its text exports and on
  its screens. Parse an export in reading order and every value attaches to the
  label of the field above it — an off-by-one down the whole file where each
  value is individually plausible. Tested in `rcuExport.test.js`.
- **Export sub-blocks reuse key names.** `PH` and `WH` both carry
  `STOP DELAY PLS`, at different values. Flattened, one silently overwrites the
  other.
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
