import { jsPDF } from 'jspdf';
import { ML, LOGO_URL, bar, cell, drawBox, checkCell, addSigImg } from './pdfHelpers.js';
import { XRAY_DIAGRAM, XRAY_DIAGRAM_RATIO } from './xrayDiagram.js';
import { XRAY_OVALS, XRAY_CALLOUTS } from './xrayOvals.js';

export function buildXrayPDF(data) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'letter', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const W = pageW - ML * 2;

  // ===== HEADER =====
  try { doc.addImage(LOGO_URL, 'PNG', ML, 8, 34, 17); } catch { /* ignore */ }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
  doc.text('X-RAY VALIDATION FORM', ML + 44, 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('Joshua Todd Industries, LLC', ML + 44, 21);
  doc.text('Gilbert, AZ', ML + 132, 21);
  doc.text('(623) 300-6445', ML + 44, 26);
  doc.text('josh@jtiaz.com', ML + 132, 26);

  let y = 34;
  const lw = 36, vw = W / 2 - lw;
  const infoRow = (l1, v1, l2, v2) => {
    cell(doc, ML, y, lw, 6, l1, { bold: true, size: 8 });
    cell(doc, ML + lw, y, vw, 6, v1);
    cell(doc, ML + lw + vw, y, lw, 6, l2, { bold: true, size: 8 });
    cell(doc, ML + lw * 2 + vw, y, vw, 6, v2);
    y += 6;
  };
  infoRow('Model Information', data.modelInformation, 'Customer Name', data.customerName);
  infoRow('Job Number', data.jobNumber, 'Customer Location', data.customerLocation);
  infoRow('Serial Number', data.serialNumber, 'Customer Contact', data.customerContact);

  // ===== MACHINE DIAGRAM with detected-radiation amounts in each oval =====
  y += 2;
  y = bar(doc, y, 'RADIATION DETECTED  (amount entered in each oval)', W);
  const iw = W, ih = W * XRAY_DIAGRAM_RATIO, ix = ML, iy = y;
  try { doc.addImage(XRAY_DIAGRAM, 'PNG', ix, iy, iw, ih); } catch { /* ignore */ }
  const ovals = data.ovals || {};
  // Every oval gets a leader line out to its value in clear space.
  doc.setTextColor(0, 0, 0);
  XRAY_OVALS.forEach((o) => {
    const v = ovals[o.n];
    if (v === undefined || v === null || String(v) === '') return;
    const ox = ix + (o.x / 100) * iw, oy = iy + (o.y / 100) * ih;
    const c = XRAY_CALLOUTS[o.n] || o;
    const cx = ix + (c.x / 100) * iw, cy = iy + (c.y / 100) * ih;
    doc.setLineWidth(0.2); doc.setDrawColor(0);
    doc.line(ox, oy, cx, cy - 2.4);
    doc.setFillColor(0, 0, 0); doc.circle(ox, oy, 0.45, 'F'); // tick at the oval
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
    doc.text(String(v), cx, cy, { align: 'center' });
  });
  y = iy + ih + 3;

  // ===== SAMPLE SIZES FOR FOREIGN MATERIAL =====
  y += 0;
  y = bar(doc, y, 'SAMPLE SIZES FOR FOREIGN MATERIAL (unit of measurement, mm)', W);
  infoRow('Product Description', data.productDescription, 'Packaging Material', data.packagingMaterial);
  cell(doc, ML, y, lw, 6, 'Package Weight', { bold: true, size: 8 });
  cell(doc, ML + lw, y, W - lw, 6, data.packageWeight);
  y += 6;

  // ===== TEST SAMPLES DETECTED =====
  y += 2;
  y = bar(doc, y, 'TEST SAMPLES DETECTED', W);
  const qc = W / 4;
  cell(doc, ML, y, qc, 6, 'Sample Type', { bold: true, align: 'center', size: 8 });
  cell(doc, ML + qc, y, qc, 6, 'Sample Sizes', { bold: true, align: 'center', size: 8 });
  cell(doc, ML + qc * 2, y, qc, 6, 'Sample Type', { bold: true, align: 'center', size: 8 });
  cell(doc, ML + qc * 3, y, qc, 6, 'Sample Sizes', { bold: true, align: 'center', size: 8 });
  y += 6;
  const samples = data.samples || [];
  const half = Math.max(1, Math.ceil(samples.length / 2));
  for (let r = 0; r < half; r++) {
    const a = samples[r] || {};
    const b = samples[half + r] || {};
    cell(doc, ML, y, qc, 6, a.type, { align: 'center' });
    cell(doc, ML + qc, y, qc, 6, a.size, { align: 'center' });
    cell(doc, ML + qc * 2, y, qc, 6, b.type, { align: 'center' });
    cell(doc, ML + qc * 3, y, qc, 6, b.size, { align: 'center' });
    y += 6;
  }

  // ===== MACHINE DIAGNOSTICS =====
  y += 2;
  y = bar(doc, y, 'MACHINE DIAGNOSTICS', W);
  cell(doc, ML, y, 50, 6, 'Was each package rejected?', { bold: true, size: 8 });
  cell(doc, ML + 50, y, 14, 6); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text('Yes', ML + 51, y + 3.8); drawBox(doc, ML + 60, y + 1, data.packageRejected === 'Yes');
  cell(doc, ML + 64, y, 14, 6); doc.text('No', ML + 65, y + 3.8); drawBox(doc, ML + 74, y + 1, data.packageRejected === 'No');
  cell(doc, ML + 78, y, 28, 6, 'Corrections', { bold: true, size: 8 });
  cell(doc, ML + 106, y, W - 106, 6, data.corrections);
  y += 6;

  const tw = W / 3;
  const lv = (x, l, v, w, labW) => { cell(doc, x, y, labW, 6, l, { bold: true, size: 7.5 }); cell(doc, x + labW, y, w - labW, 6, v); };
  lv(ML, 'Max Irradiation', data.maxIrradiation, tw, 28);
  lv(ML + tw, 'Voltage', data.voltage, tw, 22);
  lv(ML + tw * 2, 'Current', data.current, tw, 22);
  y += 6;

  const hw = W / 2;
  lv(ML, 'Line Sensor', data.lineSensor, hw, 32);
  lv(ML + hw, 'Generator Hours', data.generatorHours, hw, 32);
  y += 6;
  lv(ML, 'X-Ray Lamp', data.xrayLamp, hw, 32);
  lv(ML + hw, 'Safety Circuits', data.safetyCircuits, hw, 32);
  y += 6;

  // PASS / FAIL + DATE / DATE DUE
  y += 2;
  checkCell(doc, ML, y, hw / 2, 7, 'PASS', data.result === 'Pass');
  checkCell(doc, ML + hw / 2, y, hw / 2, 7, 'FAIL', data.result === 'Fail');
  cell(doc, ML + hw, y, hw / 2, 7); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text('DATE', ML + hw + 2, y + 4.5); doc.setFont('helvetica', 'normal'); doc.text(String(data.date || ''), ML + hw + 16, y + 4.5);
  cell(doc, ML + hw + hw / 2, y, hw / 2, 7); doc.setFont('helvetica', 'bold'); doc.text('DATE DUE', ML + hw + hw / 2 + 2, y + 4.5); doc.setFont('helvetica', 'normal'); doc.text(String(data.dateDue || ''), ML + hw + hw / 2 + 22, y + 4.5);
  y += 7;

  // ===== SIGNATURES =====
  y += 5;
  const slw = 42, svw = W / 2 - slw;
  cell(doc, ML, y, slw, 6, 'Surveyor', { bold: true, size: 8 }); cell(doc, ML + slw, y, svw, 6, data.surveyor);
  cell(doc, ML + slw + svw, y, slw, 6, 'Customer Representative', { bold: true, size: 7.3 }); cell(doc, ML + slw * 2 + svw, y, svw, 6, data.customerRepresentative);
  y += 6;
  cell(doc, ML, y, slw, 10, 'Signature', { bold: true, size: 8 }); cell(doc, ML + slw, y, svw, 10); addSigImg(doc, data.surveyorSignatureImg, ML + slw, y, svw, 10);
  cell(doc, ML + slw + svw, y, slw, 10, 'Signature', { bold: true, size: 8 }); cell(doc, ML + slw * 2 + svw, y, svw, 10); addSigImg(doc, data.customerSignatureImg, ML + slw * 2 + svw, y, svw, 10);

  return doc;
}
