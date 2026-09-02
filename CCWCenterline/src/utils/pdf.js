// The centerline document itself.
//
// One page per screen: the screen as the customer's operator will see it, and
// beneath it the same values as text so they can be read, searched and quoted
// in an email. Then a summary page listing every setting on the document.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE
// ----------------------------------------
// The screen images are indistinguishable from a photograph of a running
// machine — that is exactly what makes them useful, and exactly what makes them
// dangerous. This document is a SPECIFICATION: what the settings should be. It
// is not a record of what the machine was doing. Every page is banded and
// captioned to say so, and that banding is not optional or configurable.
// Somebody will eventually find one of these pages detached from the rest, and
// it has to be self-explanatory when they do.

import { jsPDF } from 'jspdf';

const MARK = 'CENTERLINE — TARGET SETTINGS';
const SUBMARK = 'What this machine should be set to. Not a record of current running values.';

const COLORS = {
  ink: [17, 24, 39],
  muted: [107, 114, 128],
  rule: [209, 213, 219],
  band: [17, 24, 39],
  bandText: [255, 255, 255],
  warn: [180, 83, 9],
};

const setFill = (doc, c) => doc.setFillColor(c[0], c[1], c[2]);
const setText = (doc, c) => doc.setTextColor(c[0], c[1], c[2]);
const setDraw = (doc, c) => doc.setDrawColor(c[0], c[1], c[2]);

/** The band every page carries, so a detached page still explains itself. */
function stamp(doc, centerline) {
  const w = doc.internal.pageSize.getWidth();
  setFill(doc, COLORS.band);
  doc.rect(0, 0, w, 12, 'F');
  setText(doc, COLORS.bandText);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(MARK, 10, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const who = [centerline.customer, centerline.plant, centerline.machine]
    .filter(Boolean).join(' · ');
  if (who) doc.text(who, w - 10, 8, { align: 'right' });
  setText(doc, COLORS.ink);
}

function footer(doc, centerline, page, total) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  setDraw(doc, COLORS.rule);
  doc.setLineWidth(0.2);
  doc.line(10, h - 12, w - 10, h - 12);
  setText(doc, COLORS.muted);
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  const left = [centerline.product, centerline.presetNo && `Preset ${centerline.presetNo}`,
    centerline.date].filter(Boolean).join('  ·  ');
  doc.text(left || 'Centerline', 10, h - 7.5);
  doc.text(`Page ${page} of ${total}`, w - 10, h - 7.5, { align: 'right' });
  setText(doc, COLORS.ink);
}

/** Label/value rows in two columns of a fixed width. */
function valueRows(doc, rows, x, y, width) {
  const labelW = width * 0.62;
  let cursor = y;
  doc.setFontSize(9);
  for (const row of rows) {
    doc.setFont('helvetica', 'normal');
    setText(doc, COLORS.muted);
    const label = doc.splitTextToSize(row.label, labelW - 2);
    doc.text(label[0], x, cursor);
    doc.setFont('helvetica', 'bold');
    setText(doc, COLORS.ink);
    doc.text(String(row.value), x + width, cursor, { align: 'right' });
    cursor += 5;
  }
  return cursor;
}

function coverPage(doc, centerline, gapList) {
  const w = doc.internal.pageSize.getWidth();
  stamp(doc, centerline);

  let y = 30;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Machine Centerline', 10, y);
  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setText(doc, COLORS.muted);
  doc.text(doc.splitTextToSize(SUBMARK, w - 20), 10, y);
  y += 12;
  setText(doc, COLORS.ink);

  const facts = [
    ['Customer', centerline.customer], ['Plant', centerline.plant],
    ['Machine', centerline.machine], ['Line', centerline.line],
    ['Product', centerline.product], ['Preset', centerline.presetNo],
    ['Set by', centerline.engineer], ['Date', centerline.date],
  ].filter(([, v]) => v);

  doc.setFontSize(9);
  for (const [label, value] of facts) {
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.text(label, 10, y);
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.text(String(value), 50, y);
    y += 5.5;
  }

  if (centerline.notes) {
    y += 4;
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.text('Notes', 10, y);
    y += 5;
    setText(doc, COLORS.ink);
    doc.text(doc.splitTextToSize(centerline.notes, w - 20), 10, y);
    y += doc.splitTextToSize(centerline.notes, w - 20).length * 4.5;
  }

  // Gaps go on the FRONT, not buried at the back. A blank on a specification
  // reads as "set it to nothing"; naming the gaps is what stops that.
  if (gapList?.length) {
    y += 6;
    setText(doc, COLORS.warn);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Not recorded on this centerline', 10, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    for (const gap of gapList) {
      const line = `${gap.screen}: ${gap.missing.join(', ')}`;
      const wrapped = doc.splitTextToSize(line, w - 20);
      doc.text(wrapped, 10, y);
      y += wrapped.length * 4;
    }
    setText(doc, COLORS.ink);
  }
}

function screenPage(doc, centerline, section) {
  const w = doc.internal.pageSize.getWidth();
  stamp(doc, centerline);

  let y = 24;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(section.title, 10, y);
  if (section.manual) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    setText(doc, COLORS.muted);
    doc.text(`Operation Manual ${section.manual}`, w - 10, y, { align: 'right' });
    setText(doc, COLORS.ink);
  }
  y += 5;

  // The screen, at whatever width keeps it whole.
  const imgW = w - 20;
  const imgH = imgW * (section.imageHeight / section.imageWidth);
  doc.addImage(section.image, 'JPEG', 10, y, imgW, imgH);
  setDraw(doc, COLORS.rule);
  doc.setLineWidth(0.3);
  doc.rect(10, y, imgW, imgH);
  y += imgH + 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Settings on this screen', 10, y);
  y += 5;
  valueRows(doc, section.rows, 10, y, w - 20);
}

function summaryPage(doc, centerline, rows) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  stamp(doc, centerline);

  let y = 24;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('All settings', 10, y);
  y += 8;

  let current = null;
  for (const row of rows) {
    if (y > h - 22) {
      doc.addPage();
      stamp(doc, centerline);
      y = 24;
      current = null;
    }
    if (row.section !== current) {
      current = row.section;
      y += 2;
      setText(doc, COLORS.muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(current.toUpperCase(), 10, y);
      setDraw(doc, COLORS.rule);
      doc.line(10, y + 1.5, w - 10, y + 1.5);
      y += 6;
      setText(doc, COLORS.ink);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setText(doc, COLORS.muted);
    doc.text(doc.splitTextToSize(row.label, 110)[0], 12, y);
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.text(String(row.value), w - 12, y, { align: 'right' });
    y += 5;
  }
}

/**
 * Build the document.
 *
 * `sections` are pre-rendered: {title, manual, image (data URL), imageWidth,
 * imageHeight, rows:[{label, value}]}. Rendering happens in the browser where
 * the canvases are, so this file stays about layout.
 */
export function buildCenterlinePdf(centerline, sections, tableRows, gapList) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  coverPage(doc, centerline, gapList);
  for (const section of sections) {
    doc.addPage();
    screenPage(doc, centerline, section);
  }
  if (tableRows?.length) {
    doc.addPage();
    summaryPage(doc, centerline, tableRows);
  }

  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    footer(doc, centerline, page, total);
  }
  return doc;
}

/**
 * The same settings without the screens: a plain list on as few pages as it
 * takes.
 *
 * The illustrated document is what you check a machine against; this is what
 * you hand somebody who just wants the numbers. It carries the same band and
 * the same header, because a page of settings detached from its centerline
 * still has to say which machine it belongs to and that it is a target rather
 * than a reading.
 */
export function buildSettingsListPdf(centerline, tableRows) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  stamp(doc, centerline);
  let y = 26;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Settings', 10, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setText(doc, COLORS.muted);
  const who = [centerline.customer, centerline.plant, centerline.machine, centerline.line]
    .filter(Boolean).join('  ·  ');
  const what = [centerline.product, centerline.presetNo && `Preset ${centerline.presetNo}`,
    centerline.engineer, centerline.date].filter(Boolean).join('  ·  ');
  if (who) { doc.text(who, 10, y); y += 4.5; }
  if (what) { doc.text(what, 10, y); y += 4.5; }
  setText(doc, COLORS.ink);
  y += 4;

  let current = null;
  for (const row of tableRows) {
    if (y > h - 20) {
      doc.addPage();
      stamp(doc, centerline);
      y = 26;
      current = null;
    }
    if (row.section !== current) {
      current = row.section;
      y += 2;
      setText(doc, COLORS.muted);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text(current.toUpperCase(), 10, y);
      setDraw(doc, COLORS.rule);
      doc.setLineWidth(0.2);
      doc.line(10, y + 1.5, w - 10, y + 1.5);
      y += 6;
      setText(doc, COLORS.ink);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    setText(doc, COLORS.muted);
    doc.text(doc.splitTextToSize(row.label, w - 60)[0], 12, y);
    setText(doc, COLORS.ink);
    doc.setFont('helvetica', 'bold');
    doc.text(String(row.value), w - 12, y, { align: 'right' });
    y += 6;
  }

  if (!tableRows.length) {
    setText(doc, COLORS.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('No settings recorded yet.', 10, y);
    setText(doc, COLORS.ink);
  }

  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    footer(doc, centerline, page, total);
  }
  return doc;
}

export const centerlineFileName = (centerline) => {
  const part = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '');
  return [
    'Centerline',
    part(centerline.customer) || 'Machine',
    part(centerline.product),
    centerline.date,
  ].filter(Boolean).join('_') + '.pdf';
};
