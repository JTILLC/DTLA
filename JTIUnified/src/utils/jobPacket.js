// src/utils/jobPacket.js
//
// One PDF per job: the PO, the invoice, the service report, and the receipts.
//
// Accounts payable departments reject packets for being incomplete far more
// often than for being wrong, and assembling one by hand — find the PO, find
// the signed service report, photograph the receipts, merge, email — is the
// step that gets skipped at 6pm on a Friday. So the order is fixed, what is
// missing is stated on the cover rather than discovered by the customer, and
// the whole thing is one file.
//
// The order is the order AP reads in: what they authorised, what we are
// asking for, what we did, and what it cost us. A cover sheet goes first
// because a merged PDF with no contents page is a stack of paper.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** The sections of a packet, in the order they are assembled. */
export const SECTIONS = [
  { key: 'po', label: 'Purchase order' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'serviceReport', label: 'Service report' },
  { key: 'receipts', label: 'Receipts', many: true },
];

const PDF_TYPES = ['application/pdf'];
const JPG_TYPES = ['image/jpeg', 'image/jpg'];
const PNG_TYPES = ['image/png'];

/**
 * Can this file go in a packet?
 *
 * HEIC is called out by name because it is what an iPhone produces and what a
 * technician will try to attach. Failing with "unsupported" would send somebody
 * looking for a converter; naming the fix is two seconds of their day.
 */
export const describeUnsupported = (file) => {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (PDF_TYPES.includes(type) || JPG_TYPES.includes(type) || PNG_TYPES.includes(type)) return null;
  if (type.includes('heic') || type.includes('heif') || /\.(heic|heif)$/.test(name)) {
    return `${file.name} is a HEIC photo. On the iPhone: Settings → Camera → Formats → Most Compatible, or open it in Photos and share it as a JPEG.`;
  }
  return `${file.name} is not a PDF, JPEG or PNG, so it cannot go in the packet.`;
};

/**
 * A money value as typed, as a number.
 *
 * People type "$1,234.56", "1234.56", "12", and sometimes nothing. A receipt
 * whose amount cannot be read must count as zero rather than poison the total
 * with NaN — one unreadable figure should cost you that figure, not the sum.
 */
export const parseAmount = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value ?? '').replace(/[^0-9.-]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

/** What the receipts add up to. */
export const receiptsTotal = (receipts = []) =>
  receipts.reduce((sum, r) => sum + parseAmount(r?.amount), 0);

/** Money, formatted the one way it is formatted everywhere in the packet. */
export const money = (n) =>
  `$${parseAmount(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Which sections have nothing in them — said on the cover, not discovered by AP. */
export const missingSections = (parts = {}) =>
  SECTIONS.filter((s) => (s.many ? !(parts[s.key] || []).length : !parts[s.key])).map((s) => s.label);

/** Break text into lines that fit a width, so nothing runs off the page. */
export const wrapText = (text, font, size, maxWidth) => {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(next, size) > maxWidth) { lines.push(current); current = word; }
    else current = next;
  });
  if (current) lines.push(current);
  return lines;
};

const LETTER = [612, 792];

const drawCover = (doc, font, bold, meta, parts) => {
  const page = doc.addPage(LETTER);
  const { width, height } = page.getSize();
  let y = height - 64;
  const line = (text, { size = 11, useBold = false, gap = 18, color = rgb(0.1, 0.12, 0.16) } = {}) => {
    page.drawText(String(text ?? ''), { x: 56, y, size, font: useBold ? bold : font, color });
    y -= gap;
  };

  line('JOB PACKET', { size: 22, useBold: true, gap: 30 });
  line(meta.customer || 'Customer', { size: 15, useBold: true, gap: 26 });

  const rows = [
    ['Service report', meta.sr || '—'],
    ['Invoice', meta.invoiceNumber || '—'],
    ['Date', meta.date || '—'],
    ['Amount', meta.amount != null && meta.amount !== '' ? `$${Number(meta.amount).toLocaleString()}` : '—'],
  ];
  // Stated on the front, because "what are we being asked to reimburse?" is the
  // question the cover exists to answer.
  const receiptSum = receiptsTotal(parts.receipts || []);
  if (receiptSum > 0) rows.push(['Receipts', money(receiptSum)]);
  rows.forEach(([k, v]) => {
    page.drawText(k, { x: 56, y, size: 10, font, color: rgb(0.45, 0.5, 0.56) });
    page.drawText(String(v), { x: 170, y, size: 11, font: bold, color: rgb(0.1, 0.12, 0.16) });
    y -= 18;
  });

  y -= 14;
  line('CONTENTS', { size: 10, useBold: true, gap: 20, color: rgb(0.45, 0.5, 0.56) });

  SECTIONS.forEach((s) => {
    const value = parts[s.key];
    const count = s.many ? (value || []).length : (value ? 1 : 0);
    const present = count > 0;
    const label = s.many && present ? `${s.label} (${count})` : s.label;
    page.drawText(present ? '•' : '–', {
      x: 56, y, size: 11, font: bold,
      color: present ? rgb(0.06, 0.72, 0.51) : rgb(0.85, 0.3, 0.3),
    });
    page.drawText(present ? label : `${label} — not included`, {
      x: 74, y, size: 11, font,
      color: present ? rgb(0.1, 0.12, 0.16) : rgb(0.85, 0.3, 0.3),
    });
    y -= 18;
  });

  if (meta.notes) {
    y -= 14;
    line('NOTES', { size: 10, useBold: true, gap: 18, color: rgb(0.45, 0.5, 0.56) });
    // Wrapped explicitly: pdf-lib draws one unbroken line and lets it run off
    // the page edge, which turns a long note into a silently truncated one.
    wrapText(String(meta.notes), font, 10, width - 112).forEach((l) => line(l, { size: 10, gap: 14 }));
  }

  page.drawText('Assembled by JTI', { x: 56, y: 40, size: 9, font, color: rgb(0.6, 0.64, 0.7) });
  return page;
};

/**
 * The receipts, itemised, before the images of them.
 *
 * Accounts payable checks a total against a list; they do not add up
 * photographs. Without this the packet says "here are nine pictures, work it
 * out", which is how a reimbursement sits in someone's queue for a fortnight.
 *
 * Only drawn when at least one receipt carries an amount — a page of zeroes
 * would be worse than no page.
 */
const drawExpenses = (doc, font, bold, receipts) => {
  // Drawn whenever there are receipts at all. It used to require a priced one,
  // which meant a packet of unpriced receipts silently had no list — the exact
  // case where somebody most needs to see what is unaccounted for.
  if (!receipts.length) return false;

  const page = doc.addPage(LETTER);
  const { width, height } = page.getSize();
  let y = height - 64;

  page.drawText('RECEIPTS', { x: 56, y, size: 16, font: bold, color: rgb(0.1, 0.12, 0.16) });
  y -= 28;

  const col = { desc: 56, amount: width - 56 };
  const row = (left, right, { useBold = false, color = rgb(0.1, 0.12, 0.16) } = {}) => {
    page.drawText(String(left), { x: col.desc, y, size: 10, font: useBold ? bold : font, color });
    const w = (useBold ? bold : font).widthOfTextAtSize(String(right), 10);
    page.drawText(String(right), { x: col.amount - w, y, size: 10, font: useBold ? bold : font, color });
    y -= 16;
  };

  row('Description', 'Amount', { useBold: true, color: rgb(0.45, 0.5, 0.56) });
  page.drawLine({
    start: { x: 56, y: y + 10 }, end: { x: width - 56, y: y + 10 },
    thickness: 0.5, color: rgb(0.8, 0.83, 0.87),
  });
  y -= 4;

  receipts.forEach((r) => {
    // Category first: an expense sheet is read by type, and "Fuel — Shell" is
    // the line somebody is looking for, not "shell-diesel-aug.jpg".
    const label = [r.category, r.vendor, r.name].filter(Boolean).join(' — ') || 'Receipt';
    const priced = parseAmount(r.amount) > 0;
    // An unpriced receipt is listed as such rather than as $0.00. Accounts
    // payable reading "$0.00" against a receipt assumes it is free; reading
    // "not priced" asks somebody.
    row(
      label.length > 68 ? `${label.slice(0, 65)}…` : label,
      priced ? money(r.amount) : 'not priced',
      priced ? {} : { color: rgb(0.85, 0.5, 0.1) },
    );
  });

  y -= 6;
  page.drawLine({
    start: { x: 56, y: y + 10 }, end: { x: width - 56, y: y + 10 },
    thickness: 0.5, color: rgb(0.8, 0.83, 0.87),
  });
  y -= 4;
  row('Total receipts', money(receiptsTotal(receipts)), { useBold: true });
  return true;
};

/** Put an image on its own page, scaled to fit with a margin. */
const addImagePage = async (doc, bytes, type) => {
  const img = /png/.test(type) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const page = doc.addPage(LETTER);
  const margin = 36;
  const maxW = LETTER[0] - margin * 2;
  const maxH = LETTER[1] - margin * 2;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * scale;
  const h = img.height * scale;
  page.drawImage(img, { x: (LETTER[0] - w) / 2, y: (LETTER[1] - h) / 2, width: w, height: h });
};

/**
 * Build the packet.
 *
 * `parts` is { po, invoice, serviceReport, receipts: [] }, each entry
 * { name, type, bytes }. A part that fails to merge does NOT sink the packet:
 * a corrupt receipt should cost you that receipt, not the invoice you are
 * trying to get paid on. What failed comes back in `problems`.
 */
export const buildPacket = async (meta = {}, parts = {}) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const problems = [];

  doc.setTitle(`Job packet ${meta.sr || ''} ${meta.customer || ''}`.trim());
  doc.setProducer('JTI Unified');

  drawCover(doc, font, bold, meta, parts);

  const append = async (part) => {
    if (!part?.bytes) return;
    try {
      if (/pdf/.test(part.type || '') || /\.pdf$/i.test(part.name || '')) {
        const src = await PDFDocument.load(part.bytes, { ignoreEncryption: true });
        const pages = await doc.copyPages(src, src.getPageIndices());
        pages.forEach((p) => doc.addPage(p));
      } else {
        await addImagePage(doc, part.bytes, part.type || '');
      }
    } catch (err) {
      problems.push(`${part.name || 'A file'} could not be added (${err.message}).`);
    }
  };

  for (const section of SECTIONS) {
    const value = parts[section.key];
    if (section.many) {
      // The itemised list goes immediately before the images it itemises.
      if (section.key === 'receipts') drawExpenses(doc, font, bold, value || []);
      for (const p of value || []) await append(p);
    } else await append(value);
  }

  return {
    bytes: await doc.save(), problems, missing: missingSections(parts),
    receiptsTotal: receiptsTotal(parts.receipts || []),
  };
};

/** What the file should be called when it lands on somebody's desktop. */
export const packetFileName = (meta = {}) => {
  const bits = [meta.sr, meta.customer].filter(Boolean).join(' - ').replace(/[^A-Za-z0-9 \-_.]/g, '').trim();
  return `Job Packet ${bits || 'untitled'}.pdf`;
};

/**
 * The email that goes with it.
 *
 * Body, subject and recipients only — a mailto cannot carry an attachment, so
 * the packet is downloaded and the person attaches it. Saying so IN the body
 * is deliberate: it is the one step a mailto cannot do for you, and an email
 * that says "attached" with nothing attached is worse than no email.
 */
export const packetEmail = (meta = {}, toAddresses = []) => {
  const subject = `Invoice ${meta.invoiceNumber || meta.sr || ''} — ${meta.customer || ''}`.trim();
  const body = [
    'Please find our invoice attached.',
    '',
    `Customer:       ${meta.customer || ''}`,
    meta.invoiceNumber ? `Invoice:        ${meta.invoiceNumber}` : null,
    meta.sr ? `Service report: ${meta.sr}` : null,
    meta.date ? `Date:           ${meta.date}` : null,
    meta.amount != null && meta.amount !== '' ? `Amount:         $${Number(meta.amount).toLocaleString()}` : null,
    '',
    'The attached packet contains the purchase order, invoice, signed service report and receipts.',
    '',
    'Thank you,',
    'JTI',
  ].filter((l) => l !== null).join('\n');

  return {
    to: toAddresses.filter(Boolean).join(','),
    subject,
    body,
    href: `mailto:${encodeURIComponent(toAddresses.filter(Boolean).join(','))}`
      + `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  };
};

export default { SECTIONS, buildPacket, missingSections, describeUnsupported, packetFileName, packetEmail };
