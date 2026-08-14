import { jsPDF } from 'jspdf';
import { ML, LOGO_URL, bar, cell, checkCell, addSigImg } from './pdfHelpers.js';

export function buildCheckweigherPDF(data) {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'letter', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const W = pageW - ML * 2;

  // ===== HEADER =====
  try { doc.addImage(LOGO_URL, 'PNG', ML, 8, 34, 17); } catch { /* ignore */ }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Checkweigher Span Calibration Certificate', ML + 44, 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('(623) 300-6445', ML + 44, 21);
  doc.text('Gilbert, AZ', ML + 104, 21);
  doc.text('josh@jtiaz.com', ML + 44, 26);

  let y = 32;
  const lw = 38, vw = W / 2 - lw;
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

  // ===== Zero adjust =====
  y += 3;
  cell(doc, ML, y, 70, 7, 'Does checkweigher zero adjust?', { bold: true, size: 9 });
  checkCell(doc, ML + 70, y, 25, 7, 'Yes', data.zeroAdjust === 'Yes');
  checkCell(doc, ML + 95, y, 25, 7, 'No', data.zeroAdjust === 'No');
  y += 10;

  // ===== Weight fluctuation =====
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Verify weight fluctuation is minimal', ML, y + 2);
  y += 4;
  cell(doc, ML, y, 48, 6, 'Lowest weight reading', { bold: true, size: 8 });
  cell(doc, ML + 48, y, 42, 6, data.lowestWeight);
  cell(doc, ML + 90, y, 55, 6, 'Highest weight reading', { bold: true, size: 8 });
  cell(doc, ML + 145, y, W - 145, 6, data.highestWeight);
  y += 10;

  // ===== Perform span adjustment + span cal weight size (left)  |  Position table (right) =====
  let ly = y;
  checkCell(doc, ML, ly, 62, 6, 'Perform Span Adjustment', !!data.performSpanAdjustment);
  ly += 6;
  cell(doc, ML, ly, 45, 6, 'Span Calibration weight size', { bold: true, size: 7.3 });
  cell(doc, ML + 45, ly, 50, 6, data.spanCalWeightSize);
  ly += 6;

  const ptx = ML + 110, ptw1 = 45, ptw2 = W - 110 - ptw1;
  cell(doc, ptx, y, ptw1, 6, 'Position', { bold: true, align: 'center', size: 8 });
  cell(doc, ptx + ptw1, y, ptw2, 6, 'Reading', { bold: true, align: 'center', size: 8 });
  let pty = y + 6;
  [['1   Top Left', 'topLeft'], ['2   Top Right', 'topRight'], ['3   Bottom Left', 'bottomLeft'], ['4   Bottom Right', 'bottomRight']]
    .forEach(([label, key]) => {
      cell(doc, ptx, pty, ptw1, 6, label, { size: 8 });
      cell(doc, ptx + ptw1, pty, ptw2, 6, data.positionReadings?.[key], { align: 'center' });
      pty += 6;
    });
  y = Math.max(ly, pty) + 5;

  // ===== Sample Weight Tests (20) =====
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Sample Weight Tests (20)', ML + W / 2, y + 2, { align: 'center' });
  y += 4;
  const cwc = W / 4;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 4; c++) {
      cell(doc, ML + c * cwc, y, cwc, 6, data.sampleWeights?.[r * 4 + c], { align: 'center' });
    }
    y += 6;
  }
  cell(doc, ML, y, W, 16);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
  doc.text('Comments:', ML + 2, y + 4);
  if (data.comments) {
    doc.setFont('helvetica', 'normal');
    doc.text(doc.splitTextToSize(String(data.comments), W - 30), ML + 24, y + 4);
  }
  y += 16 + 5;

  // ===== Sample Information and Description =====
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Sample Information and Description', ML + W / 2, y + 2, { align: 'center' });
  y += 4;
  [['Product', 'product'], ['Speed', 'speed'], ['Actual Weight', 'actualWeight'], ['Mean Weight', 'meanWeight'], ['Standard Deviation', 'standardDeviation']]
    .forEach(([label, key]) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
      doc.text(label, ML + 52, y + 4, { align: 'right' });
      cell(doc, ML + 56, y, W - 56, 6, data[key]);
      y += 6;
    });
  y += 4;

  // ===== Disclaimer =====
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  const disc = 'Joshua Todd Industries verifies that the checkweigher was operational and weighing properly. We do not accept responsibility for package weights beyond this test.';
  doc.text(doc.splitTextToSize(disc, W), ML, y + 4);
  y += 13;

  // ===== Signatures =====
  doc.setFontSize(10);
  doc.text('Customer Name (print)', ML, y + 4); doc.text(String(data.signerName || ''), ML + 52, y + 4); doc.line(ML + 50, y + 5, ML + 135, y + 5);
  y += 13;
  doc.text('Customer Signature', ML, y + 4); doc.line(ML + 45, y + 5, ML + 112, y + 5); addSigImg(doc, data.customerSignatureImg, ML + 46, y - 2, 64, 9);
  doc.text('Date', ML + 120, y + 4); doc.text(String(data.customerDate || ''), ML + 134, y + 4); doc.line(ML + 132, y + 5, ML + W, y + 5);
  y += 13;
  doc.text('Validator Signature', ML, y + 4); doc.line(ML + 45, y + 5, ML + 112, y + 5); addSigImg(doc, data.validatorSignatureImg, ML + 46, y - 2, 64, 9);
  doc.text('Date', ML + 120, y + 4); doc.text(String(data.validatorDate || ''), ML + 134, y + 4); doc.line(ML + 132, y + 5, ML + W, y + 5);

  return doc;
}
