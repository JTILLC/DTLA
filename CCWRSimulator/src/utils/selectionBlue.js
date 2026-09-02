/**
 * The blue a selected part of the machine turns.
 *
 * Measured off a capture of the running original: selecting does not tint the
 * grey, it REPLACES it with a blue that keeps a little of the original shading.
 * So the recolour is built from luminance rather than multiplied, which is why
 * a selected hopper still reads as a three-dimensional box.
 *
 * This lives in one place because the Zero Adjustment hoppers and the Feeder
 * Adjust trough wedges have to look like the same machine doing the same thing.
 * They did not: both used these numbers, but the trough artwork is far darker
 * than the hoppers, so the same ramp turned the wedges into muddy navy while
 * the hoppers came out a clear, obviously-selected blue. See liftToHopperRange.
 */

export const BLUE_BASE = [38, 39, 148];
export const BLUE_GAIN = [0.30, 0.30, 0.35];

// Head numbers and weights are printed in the RCU's own blue and would vanish
// into the new fill, so they are lifted to near-white as the real unit does.
export const TEXT_ON_BLUE = [235, 238, 255];
export const isInk = (r, g, b) => r < 140 && g < 140 && b > r + 30;

/**
 * Printed WHITE marks are left alone.
 *
 * Read off the one wedge the capture had selected: everything at luminance 230
 * and up came back pure white, while everything below it was tinted. Those are
 * the head numbers printed over the artwork, and the machine draws them on top
 * of the blue rather than through it. Tinting them turned the numbers on a
 * selected wedge into pale blue you could barely read.
 */
const WHITE_MARK = 225;

/**
 * Lift trough luminance into the range the hoppers occupy.
 *
 * Measured over both label maps: the hoppers run p5 67 to p95 203, the trough
 * wedges p5 19 to p95 209. The wedges' dark end is the whole problem — a wedge
 * pixel at 19 came out almost black-blue, where nothing on the Zero Adjustment
 * screen ever does. Stretching the one range onto the other keeps each wedge's
 * own shading and its lighting differences from its neighbours, and only stops
 * the darkest of them collapsing into a colour that does not read as selected.
 */
const LIFT_FROM = [19, 209];
const LIFT_TO = [67, 203];
const SCALE = (LIFT_TO[1] - LIFT_TO[0]) / (LIFT_FROM[1] - LIFT_FROM[0]);

export const liftToHopperRange = (lum) => LIFT_TO[0] + (lum - LIFT_FROM[0]) * SCALE;

/**
 * Paint one pixel of an ImageData as selected.
 *
 * `lift` maps the source luminance before the ramp; pass liftToHopperRange for
 * the trough and leave it out for artwork that is already in the hoppers' range.
 */
export function paintSelected(d, o, lift) {
  const r = d[o]; const g = d[o + 1]; const b = d[o + 2];
  if (isInk(r, g, b)) {
    d[o] = TEXT_ON_BLUE[0]; d[o + 1] = TEXT_ON_BLUE[1]; d[o + 2] = TEXT_ON_BLUE[2];
    return;
  }
  let lum = (r + g + b) / 3;
  if (lum >= WHITE_MARK) return;              // a printed number: drawn on top
  if (lift) lum = lift(lum);
  d[o] = BLUE_BASE[0] + lum * BLUE_GAIN[0];
  d[o + 1] = BLUE_BASE[1] + lum * BLUE_GAIN[1];
  d[o + 2] = BLUE_BASE[2] + lum * BLUE_GAIN[2];
}
