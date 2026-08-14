// Oval positions (as % of the diagram image) where the detected-radiation amount
// is entered. 17 ovals across the 6 machine views (1, 1, 4, 6, 4, 1).
export const XRAY_OVALS = [
  { n: 1, x: 10.5, y: 14.0 },                                                          // top-left (A)
  { n: 2, x: 34.5, y: 16.9 },                                                          // top 2nd
  { n: 3, x: 10.5, y: 48.1 }, { n: 4, x: 8.6, y: 64.5 }, { n: 5, x: 11.4, y: 64.5 }, { n: 6, x: 14.4, y: 64.5 }, // bottom-left (4)
  { n: 7, x: 35, y: 43.9 }, { n: 8, x: 35, y: 51.7 }, { n: 9, x: 35, y: 61.8 },
  { n: 10, x: 30.9, y: 72.5 }, { n: 11, x: 34.9, y: 72.5 }, { n: 12, x: 38.9, y: 72.5 }, // 2nd from bottom-left (6)
  { n: 13, x: 58.4, y: 47.3 }, { n: 14, x: 54.4, y: 63.4 }, { n: 15, x: 57.9, y: 63.4 }, { n: 16, x: 60.6, y: 63.4 }, // 3rd from bottom-left (4)
  { n: 17, x: 82.5, y: 61.0 },                                                         // bottom-right
];

// The tiny inner-detector ovals are too small to hold a value; on the PDF a leader
// line points from the oval to a readable callout below the machine, and the form
// input is placed at the same callout spot (so the boxes don't overlap).
// Every oval gets a leader line out to a readable callout in clear space.
// Upper / standalone ovals point to the side gaps; lower detector rows drop below the image.
export const XRAY_CALLOUTS = {
  1: { x: 23, y: 14 }, 2: { x: 49, y: 17 },
  3: { x: 22, y: 48 }, 4: { x: 4.5, y: 99 }, 5: { x: 9.5, y: 99 }, 6: { x: 14.5, y: 99 },
  7: { x: 45, y: 44 }, 8: { x: 45, y: 52 }, 9: { x: 45, y: 60 },
  10: { x: 27.5, y: 99 }, 11: { x: 33, y: 99 }, 12: { x: 38.5, y: 99 },
  13: { x: 69, y: 47 }, 14: { x: 52, y: 99 }, 15: { x: 57, y: 99 }, 16: { x: 62, y: 99 },
  17: { x: 95, y: 61 },
};
