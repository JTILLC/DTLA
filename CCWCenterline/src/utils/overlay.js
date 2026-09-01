// Printing centerline values onto the RCU screens, in the machine's own boxes.
//
// The screenshots have one machine's numbers baked into them (a 14-head unit
// running POTATO CHIPS at 90.0 g). To show a different customer's settings each
// value box is erased and the new value drawn in the RCU's own blue, so the
// result reads as the screen that customer should be looking at. That is the
// point of the document: an operator holds the page against the live machine
// and compares field by field.
//
// Erasing is the fiddly half. A flat fill is wrong — the field faces carry a
// vertical gradient, so one sampled colour leaves an obvious patch and the page
// looks doctored. Each row is repainted with the median of its OWN non-text
// pixels, which follows the gradient and works equally on the grey buttons and
// the green list panels.
//
// Port of tools/overlay.py, same approach and same output.

export const RCU_BLUE = '#0000cc';

/** Is this pixel part of the printed value rather than the field behind it? */
const isValueInk = (r, g, b) => r < 140 && g < 140 && b > r + 30;

/**
 * Erase one value box, leaving the field looking untouched.
 *
 * Works on an ImageData in place. `box` is [x0, y0, x1, y1] inclusive.
 */
export function repaintBox(imageData, box) {
  const [x0, y0, x1, y1] = box;
  const { data, width } = imageData;
  const row = [];

  for (let y = Math.max(0, y0); y <= Math.min(imageData.height - 1, y1); y += 1) {
    row.length = 0;
    for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (!isValueInk(r, g, b)) row.push([r, g, b]);
    }
    if (!row.length) continue;
    // Median by luminance: robust to the odd antialiased edge pixel that the
    // ink test lets through, where a mean would drag the whole row darker.
    row.sort((p, q) => (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]));
    const [mr, mg, mb] = row[row.length >> 1];
    for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x += 1) {
      const i = (y * width + x) * 4;
      data[i] = mr;
      data[i + 1] = mg;
      data[i + 2] = mb;
    }
  }
}

/** The text to print for a field, with its unit appended if not already there. */
export function displayValue(value, unit) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!unit) return text;
  return text.endsWith(unit) ? text : text + unit;
}

/**
 * Draw a screen with the centerline's values in place of the baked-in ones.
 *
 * `image` is a loaded HTMLImageElement of the 800x600 screenshot. Returns a
 * canvas; fields with no value are left exactly as the screenshot has them,
 * which is deliberate — an untouched field is visibly the sample machine's,
 * and a blank one would read as "set this to nothing".
 */
export function renderScreen(image, fields, values) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);

  const written = [];
  const wanted = fields.filter((f) => displayValue(values?.[f.key], f.unit));
  if (!wanted.length) return { canvas, written };

  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (const field of wanted) repaintBox(frame, field.box);
  ctx.putImageData(frame, 0, 0);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = RCU_BLUE;
  ctx.font = 'bold 15px Helvetica, Arial, sans-serif';
  for (const field of wanted) {
    const [x0, y0, x1, y1] = field.box;
    const text = displayValue(values[field.key], field.unit);
    ctx.fillText(text, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0 - 4);
    written.push({ label: field.label, text });
  }
  return { canvas, written };
}

/** Load an image URL, resolving only once it can actually be drawn. */
export const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
