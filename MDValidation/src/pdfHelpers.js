// Shared low-level jsPDF drawing helpers used by the per-form PDF builders.
export const ML = 8;             // left margin (mm)
export const LOGO_URL = 'https://i.imgur.com/GQRZTtW.png'; // JTI logo

export function bar(doc, y, title, w) {
  const h = 6;
  doc.setFillColor(0, 0, 0);
  doc.rect(ML, y, w, h, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(title, ML + w / 2, y + 4.2, { align: 'center' });
  doc.setTextColor(0);
  doc.setLineWidth(0.2);
  return y + h;
}

export function cell(doc, x, y, w, h, text, opts = {}) {
  doc.setDrawColor(0);
  doc.setLineWidth(0.2);
  if (opts.fill) { doc.setFillColor(...opts.fill); doc.rect(x, y, w, h, 'F'); }
  doc.rect(x, y, w, h);
  if (text !== undefined && text !== null && text !== '') {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size || 9);
    const cy = y + h / 2 + (opts.size ? opts.size * 0.12 : 1.1);
    if (opts.align === 'center') doc.text(String(text), x + w / 2, cy, { align: 'center', maxWidth: w - 2 });
    else doc.text(String(text), x + 1.6, cy, { maxWidth: w - 3 });
  }
}

export function drawBox(doc, x, y, checked) {
  doc.setLineWidth(0.3);
  doc.setDrawColor(0);
  doc.rect(x, y, 4, 4);
  if (checked) {
    doc.setLineWidth(0.8);
    doc.line(x + 0.7, y + 2.1, x + 1.6, y + 3.2);
    doc.line(x + 1.6, y + 3.2, x + 3.4, y + 0.6);
    doc.setLineWidth(0.2);
  }
}

export function checkCell(doc, x, y, w, h, label, checked) {
  cell(doc, x, y, w, h);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(String(label), x + 2, y + h / 2 + 1.1, { maxWidth: w - 12 });
  drawBox(doc, x + w - 7, y + h / 2 - 2, checked);
}

// Underlined fill-in field: "Label _______value______"
export function underField(doc, x, y, label, value, labelW, fieldW, size = 9) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(size);
  doc.text(String(label), x, y);
  doc.setFont('helvetica', 'normal');
  doc.text(String(value || ''), x + labelW + 1, y, { maxWidth: fieldW - 2 });
  doc.setLineWidth(0.2); doc.setDrawColor(0);
  doc.line(x + labelW, y + 1.4, x + labelW + fieldW, y + 1.4);
}

export function addSigImg(doc, img, x, y, w, h) {
  if (!img) return;
  try {
    const maxW = Math.min(w - 4, 48), maxH = h - 2;
    const p = doc.getImageProperties(img);
    // fit within the box preserving aspect ratio; sit the signature on the line
    let dw = maxW, dh = (p.height / p.width) * dw;
    if (dh > maxH) { dh = maxH; dw = (p.width / p.height) * dh; }
    doc.addImage(img, 'PNG', x + 2, y + 1 + (maxH - dh), dw, dh);
  } catch { /* ignore */ }
}
