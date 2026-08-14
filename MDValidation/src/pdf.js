import { jsPDF } from 'jspdf';
import { SAMPLE_TYPES, EJECTION_TYPES } from './formModel.js';

const LOGO_URL = 'https://i.imgur.com/GQRZTtW.png'; // JTI logo
const ML = 8;            // left margin (mm)

// ---- low-level helpers --------------------------------------------------
function bar(doc, y, title, w) {
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

function cell(doc, x, y, w, h, text, opts = {}) {
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

// a labelled checkbox inside a cell of width w: "Label        [x]"
function checkCell(doc, x, y, w, h, label, checked) {
  cell(doc, x, y, w, h);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(String(label), x + 2, y + h / 2 + 1.1, { maxWidth: w - 12 });
  drawBox(doc, x + w - 7, y + h / 2 - 2, checked);
}

function drawBox(doc, x, y, checked) {
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

// ---- main builder -------------------------------------------------------
export function buildValidationPDF(data) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'letter', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const W = pageW - ML * 2; // content width

  // ===== HEADER =====
  try { doc.addImage(LOGO_URL, 'PNG', ML, 8, 34, 17); } catch { /* ignore */ }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
  doc.text('METAL DETECTION VALIDATION FORM', ML + 44, 14);
  doc.setFontSize(11);
  doc.text('Joshua Todd Industries (JTI)', ML + 44, 21);
  doc.text('Gilbert, AZ', ML + 120, 21);
  doc.setFont('helvetica', 'normal');
  doc.text('Phone: (623) 300-6445', ML + 44, 27);
  doc.text('Email: Josh@jtiaz.com', ML + 120, 27);
  doc.setFontSize(9);
  doc.text(`CERTIFICATE NO:   ${data.certificateNo || ''}`, ML + 44, 33);

  let y = 38;

  // ===== CUSTOMER INFORMATION =====
  y = bar(doc, y, 'CUSTOMER INFORMATION', W);
  const lw = 32, vw = W / 2 - lw; // label width, value width per half
  const infoRow = (l1, v1, l2, v2) => {
    cell(doc, ML, y, lw, 6, l1, { bold: true });
    cell(doc, ML + lw, y, vw, 6, v1);
    cell(doc, ML + lw + vw, y, lw, 6, l2, { bold: true });
    cell(doc, ML + lw * 2 + vw, y, vw, 6, v2);
    y += 6;
  };
  infoRow('Company', data.company, 'Address', data.address);
  infoRow('Customer Contact', data.customerContact, 'Position', data.position);
  infoRow('Phone', data.phone, 'Email', data.email);

  // ===== METAL DETECTOR INFORMATION =====
  y += 2;
  y = bar(doc, y, 'METAL DETECTOR INFORMATION', W);
  infoRow('Brand', data.brand, 'Model', data.model);
  infoRow('Serial Number', data.serialNumber, 'Dimensions', data.dimensions);

  // ===== TRANSIT TYPE =====
  y += 2;
  y = bar(doc, y, 'Transit Type', W);
  const third = W / 3;
  ['Belt', 'Modular', 'Drop'].forEach((t, i) => {
    checkCell(doc, ML + i * third, y, third, 6, t, data.transitType === t);
  });
  y += 6;

  // ===== EJECTION TYPE =====
  y += 2;
  y = bar(doc, y, 'Ejection Type', W);
  const isEj = (t) => (data.ejectionTypes || []).includes(t);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      const idx = r * 3 + c;
      if (idx >= EJECTION_TYPES.length) { cell(doc, ML + c * third, y, third, 6); continue; }
      const t = EJECTION_TYPES[idx];
      if (t === 'Other') {
        // Other + free text
        cell(doc, ML + c * third, y, third, 6);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        doc.text('Other', ML + c * third + 2, y + 3.6);
        drawBox(doc, ML + c * third + 20, y + 1, isEj('Other'));
        doc.setFontSize(8);
        doc.text(String(data.ejectionOther || ''), ML + c * third + 26, y + 3.6, { maxWidth: third - 28 });
      } else {
        checkCell(doc, ML + c * third, y, third, 6, t, isEj(t));
      }
    }
    y += 6;
  }

  // ===== PRODUCT DEFAULT DETECTION (FACTORY DEFAULT) =====
  y += 2;
  y = bar(doc, y, 'Product Default Detection (Factory Default)', W);
  const fc = [W * 0.24, W * 0.16, W * 0.2, W * 0.2, W * 0.1, W * 0.1]; // Sample, Diameter, Manufacturer, Serial, YES, NO
  const fx = [ML, ML + fc[0], ML + fc[0] + fc[1], ML + fc[0] + fc[1] + fc[2], ML + fc[0] + fc[1] + fc[2] + fc[3], ML + fc[0] + fc[1] + fc[2] + fc[3] + fc[4]];
  cell(doc, fx[0], y, fc[0], 6, 'Sample Type', { bold: true, align: 'center' });
  cell(doc, fx[1], y, fc[1], 6, 'Diameter', { bold: true, align: 'center' });
  cell(doc, fx[2], y, fc[2], 6, 'Manufacturer', { bold: true, align: 'center' });
  cell(doc, fx[3], y, fc[3], 6, 'Serial Number', { bold: true, align: 'center' });
  cell(doc, fx[4], y, fc[4] + fc[5], 6, 'Detected', { bold: true, align: 'center' });
  y += 6;
  SAMPLE_TYPES.forEach((s) => {
    const row = data.factory?.[s.key] || {};
    cell(doc, fx[0], y, fc[0], 6, s.label);
    cell(doc, fx[1], y, fc[1], 6, row.diameter);
    cell(doc, fx[2], y, fc[2], 6, row.manufacturer);
    cell(doc, fx[3], y, fc[3], 6, row.serial);
    checkCell(doc, fx[4], y, fc[4], 6, 'YES', row.detected === 'Yes');
    checkCell(doc, fx[5], y, fc[5], 6, 'NO', row.detected === 'No');
    y += 6;
  });

  // ===== PRODUCT DESCRIPTION AND OBSERVATION =====
  y += 2;
  y = bar(doc, y, 'Product Description and Observation', W);
  // Row: Product Type | <val> | Wet [] | Dry []
  cell(doc, ML, y, lw, 6, 'Product Type', { bold: true });
  cell(doc, ML + lw, y, vw, 6, data.productType);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  cell(doc, ML + lw + vw, y, (lw + vw) / 2, 6); doc.text('Wet', ML + lw + vw + 2, y + 3.6); drawBox(doc, ML + lw + vw + (lw + vw) / 2 - 7, y + 1, data.wetDry === 'Wet');
  cell(doc, ML + lw + vw + (lw + vw) / 2, y, (lw + vw) / 2, 6); doc.text('Dry', ML + lw + vw + (lw + vw) / 2 + 2, y + 3.6); drawBox(doc, ML + W - 7, y + 1, data.wetDry === 'Dry');
  y += 6;
  // Yes/No pair rows
  const ynRow = (l1, v1, l2, v2) => {
    const half = W / 2;
    const labW = half - 24;
    cell(doc, ML, y, labW, 6, l1, { bold: true });
    cell(doc, ML + labW, y, 12, 6); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('Yes', ML + labW + 1, y + 3.6); drawBox(doc, ML + labW + 7.5, y + 1, v1 === 'Yes');
    cell(doc, ML + labW + 12, y, 12, 6); doc.text('No', ML + labW + 13, y + 3.6); drawBox(doc, ML + labW + 19.5, y + 1, v1 === 'No');
    cell(doc, ML + half, y, labW, 6, l2, { bold: true });
    cell(doc, ML + half + labW, y, 12, 6); doc.text('Yes', ML + half + labW + 1, y + 3.6); drawBox(doc, ML + half + labW + 7.5, y + 1, v2 === 'Yes');
    cell(doc, ML + half + labW + 12, y, 12, 6); doc.text('No', ML + half + labW + 13, y + 3.6); drawBox(doc, ML + half + labW + 19.5, y + 1, v2 === 'No');
    y += 6;
  };
  ynRow('Metal Detector in production', data.inProduction, 'Is system stable', data.systemStable);
  // Baseline readings (Bars/Stars) | Is system damaged (Yes/No)
  const half = W / 2, labW = half - 24;
  const blLab = 38, blCell = (half - blLab) / 2;
  cell(doc, ML, y, blLab, 6, 'Baseline Readings', { bold: true, size: 8 });
  cell(doc, ML + blLab, y, blCell, 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text('Bars', ML + blLab + 1.5, y + 3.8);
  doc.text(String(data.baselineBars || ''), ML + blLab + 12, y + 3.8, { maxWidth: blCell - 13 });
  cell(doc, ML + blLab + blCell, y, blCell, 6);
  doc.text('Stars', ML + blLab + blCell + 1.5, y + 3.8);
  doc.text(String(data.baselineStars || ''), ML + blLab + blCell + 13, y + 3.8, { maxWidth: blCell - 14 });
  cell(doc, ML + half, y, labW, 6, 'Is system damaged', { bold: true });
  cell(doc, ML + half + labW, y, 12, 6); doc.setFontSize(8); doc.text('Yes', ML + half + labW + 1, y + 3.6); drawBox(doc, ML + half + labW + 7.5, y + 1, data.systemDamaged === 'Yes');
  cell(doc, ML + half + labW + 12, y, 12, 6); doc.text('No', ML + half + labW + 13, y + 3.6); drawBox(doc, ML + half + labW + 19.5, y + 1, data.systemDamaged === 'No');
  y += 6;
  doc.setFont('helvetica', 'italic'); doc.setFontSize(8);
  doc.text('***If system is damaged explain in notes below***', ML + W / 2, y + 3.6, { align: 'center' });
  cell(doc, ML, y, W, 6);
  y += 6;

  // ===== DETAILED OBSERVATION =====
  y += 2;
  y = bar(doc, y, 'Detailed Observation if Unstable and/or Damaged', W);
  const obsH = pageH - 18 - y;
  cell(doc, ML, y, W, obsH);
  if (data.detailedObservation) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text(doc.splitTextToSize(String(data.detailedObservation), W - 4), ML + 2, y + 5);
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Page 1 of 2', pageW / 2, pageH - 8, { align: 'center' });

  // ===== PAGE 2 =====
  doc.addPage();
  y = 12;
  const ensure = (need) => { if (y + need > pageH - 12) { doc.addPage(); y = 12; } };

  (data.productSetups || []).forEach((p) => {
    ensure(60);
    y = bar(doc, y, 'PRODUCT SETUP', W);
    infoRowAt(doc, y, ML, W, 'Product Name', p.productName, 'Product Description', p.productDescription); y += 6;
    quadRow(doc, y, ML, W, ['Sensitivity', p.sensitivity, 'Band', p.band, 'TX Program', p.txProgram, 'Belt Speed', p.beltSpeed]); y += 6;
    quadRow(doc, y, ML, W, ['Ejection Mode', p.ejectionMode, 'Ejection Distance', p.ejectionDistance, 'Ejection Time', p.ejectionTime, '', '']); y += 6;
    infoRowAt(doc, y, ML, W, 'Noise Signal Running', p.noiseRunning, 'Noise Signal Ejecting', p.noiseEjecting); y += 6;
    // Metal Detection During Production
    y = bar(doc, y, 'Metal Detection During Production', W);
    const mc = [W * 0.34, W * 0.3, W * 0.18, W * 0.18];
    const mx = [ML, ML + mc[0], ML + mc[0] + mc[1], ML + mc[0] + mc[1] + mc[2]];
    cell(doc, mx[0], y, mc[0], 6, 'Sample Type', { bold: true, align: 'center' });
    cell(doc, mx[1], y, mc[1], 6, 'Diameter', { bold: true, align: 'center' });
    cell(doc, mx[2], y, mc[2], 6, 'Detected', { bold: true, align: 'center' });
    cell(doc, mx[3], y, mc[3], 6, 'Ejected', { bold: true, align: 'center' });
    y += 6;
    SAMPLE_TYPES.forEach((s) => {
      const r = p.detection?.[s.key] || {};
      cell(doc, mx[0], y, mc[0], 6, s.label);
      cell(doc, mx[1], y, mc[1], 6, r.diameter);
      cell(doc, mx[2], y, mc[2], 6); drawBox(doc, mx[2] + mc[2] / 2 - 2, y + 1, !!r.detected);
      cell(doc, mx[3], y, mc[3], 6); drawBox(doc, mx[3] + mc[3] / 2 - 2, y + 1, !!r.ejected);
      y += 6;
    });
    y += 3;
  });

  // ===== VALIDATION RESULTS =====
  ensure(14);
  y = bar(doc, y, 'METAL DETECTOR VALIDATION RESULTS', W);
  checkCell(doc, ML, y, W / 2, 7, 'PASS', data.validationResult === 'Pass');
  checkCell(doc, ML + W / 2, y, W / 2, 7, 'FAIL', data.validationResult === 'Fail');
  y += 7;

  // ===== FINAL NOTES =====
  y += 2;
  ensure(30);
  y = bar(doc, y, 'FINAL NOTES AND OBSERVATIONS', W);
  const fnH = 34;
  cell(doc, ML, y, W, fnH);
  if (data.finalNotes) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(doc.splitTextToSize(String(data.finalNotes), W - 4), ML + 2, y + 5); }
  y += fnH + 3;

  // Disclaimer
  ensure(30);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  const disc = 'Joshua Todd Industries (JTI) is not responsible for any issues after validation as both parties were present and observed detection and ejection of test material. Mechanical or electrical issues during or after observation may need to be handled by manufacturer. Customer acknowledges below.';
  doc.text(doc.splitTextToSize(disc, W), ML, y + 4);
  y += 16;

  // ===== SIGNATURES =====
  ensure(26);
  y = bar(doc, y, 'CUSTOMER ACKNOWLEDGEMENT AND SIGNATURES', W);
  infoRowAt(doc, y, ML, W, 'Date of Validation', data.dateOfValidation, 'Renewal Date', data.renewalDate); y += 6;
  infoRowAt(doc, y, ML, W, 'Customer Representative', data.customerRepresentative, 'Validator Name', data.validatorName); y += 6;
  // signature rows render names in a signature font
  sigRow(doc, y, ML, W, 'Customer Signature', data.customerSignatureImg, 'Validator Signature', data.validatorSignatureImg); y += 10;

  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Page 2 of 2', pageW / 2, pageH - 8, { align: 'center' });

  return doc;
}

// ---- page-2 row helpers (defined after to keep builder readable) --------
function infoRowAt(doc, y, ML2, W, l1, v1, l2, v2) {
  const lw = 42, vw = W / 2 - lw;
  cell(doc, ML2, y, lw, 6, l1, { bold: true, size: 8 });
  cell(doc, ML2 + lw, y, vw, 6, v1);
  cell(doc, ML2 + lw + vw, y, lw, 6, l2, { bold: true, size: 8 });
  cell(doc, ML2 + lw * 2 + vw, y, vw, 6, v2);
}

function quadRow(doc, y, ML2, W, items) {
  const cw = W / 4, lw = cw * 0.5, vw = cw - lw;
  for (let i = 0; i < 4; i++) {
    const x = ML2 + i * cw;
    const l = items[i * 2], v = items[i * 2 + 1];
    cell(doc, x, y, lw, 6, l, { bold: true, size: 7.5 });
    cell(doc, x + lw, y, vw, 6, v, { size: 8 });
  }
}

function sigRow(doc, y, ML2, W, l1, img1, l2, img2) {
  const lw = 42, vw = W / 2 - lw, h = 10;
  cell(doc, ML2, y, lw, h, l1, { bold: true, size: 8 });
  cell(doc, ML2 + lw, y, vw, h);
  addSigImg(doc, img1, ML2 + lw, y, vw, h);
  cell(doc, ML2 + lw + vw, y, lw, h, l2, { bold: true, size: 8 });
  cell(doc, ML2 + lw * 2 + vw, y, vw, h);
  addSigImg(doc, img2, ML2 + lw * 2 + vw, y, vw, h);
}

function addSigImg(doc, img, x, y, w, h) {
  if (!img) return;
  try { doc.addImage(img, 'PNG', x + 2, y + 1, Math.min(w - 4, 48), h - 2); } catch { /* ignore */ }
}
