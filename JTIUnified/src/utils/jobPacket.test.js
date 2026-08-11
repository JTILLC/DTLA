// Assembling the packet. The failure that costs real money is a packet that
// looks complete and is not, so most of these are about what it SAYS is
// missing and about one bad file not taking the invoice down with it.
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  SECTIONS, buildPacket, missingSections, describeUnsupported,
  packetFileName, packetEmail, wrapText,
} from './jobPacket.js';

// A real, valid PDF of n pages, so the merge is exercised rather than mocked.
const pdfBytes = async (pages = 1) => {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) d.addPage([612, 792]);
  return d.save();
};
const part = async (name, pages = 1) => ({ name, type: 'application/pdf', bytes: await pdfBytes(pages) });

describe('missingSections', () => {
  it('names every empty section', () => {
    expect(missingSections({})).toEqual(['Purchase order', 'Invoice', 'Service report', 'Receipts']);
  });

  it('an empty receipts list is missing, not satisfied', () => {
    expect(missingSections({ receipts: [] })).toContain('Receipts');
    expect(missingSections({ receipts: [{ name: 'a' }] })).not.toContain('Receipts');
  });

  it('is empty when everything is there', () => {
    expect(missingSections({ po: {}, invoice: {}, serviceReport: {}, receipts: [{}] })).toEqual([]);
  });
});

describe('describeUnsupported', () => {
  it('accepts PDF, JPEG and PNG', () => {
    expect(describeUnsupported({ name: 'a.pdf', type: 'application/pdf' })).toBeNull();
    expect(describeUnsupported({ name: 'a.jpg', type: 'image/jpeg' })).toBeNull();
    expect(describeUnsupported({ name: 'a.png', type: 'image/png' })).toBeNull();
  });

  it('tells an iPhone user how to fix a HEIC rather than just refusing it', () => {
    const msg = describeUnsupported({ name: 'IMG_0421.HEIC', type: 'image/heic' });
    expect(msg).toMatch(/Most Compatible|JPEG/);
    // Also catches the case where the browser reports no type at all.
    expect(describeUnsupported({ name: 'IMG_0421.heic', type: '' })).toMatch(/HEIC/);
  });

  it('refuses anything else by name', () => {
    expect(describeUnsupported({ name: 'notes.docx', type: 'application/msword' })).toMatch(/notes.docx/);
  });
});

describe('buildPacket', () => {
  it('merges every part, in order, behind a cover page', async () => {
    const parts = {
      po: await part('po.pdf', 1),
      invoice: await part('invoice.pdf', 2),
      serviceReport: await part('sr.pdf', 3),
      receipts: [await part('r1.pdf', 1), await part('r2.pdf', 1)],
    };
    const { bytes, problems, missing } = await buildPacket({ sr: '2026024', customer: 'Flagstone Foods' }, parts);
    const out = await PDFDocument.load(bytes);
    expect(out.getPageCount()).toBe(1 + 1 + 2 + 3 + 2); // cover + parts
    expect(problems).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('still produces a packet when parts are missing, and says which', async () => {
    const { bytes, missing } = await buildPacket({ sr: '2026024' }, { invoice: await part('i.pdf') });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2); // cover + invoice
    expect(missing).toEqual(['Purchase order', 'Service report', 'Receipts']);
  });

  it('a corrupt receipt costs you the receipt, not the invoice', async () => {
    const parts = {
      invoice: await part('invoice.pdf', 2),
      receipts: [{ name: 'broken.pdf', type: 'application/pdf', bytes: new Uint8Array([1, 2, 3, 4]) }],
    };
    const { bytes, problems } = await buildPacket({ sr: 'x' }, parts);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/broken\.pdf/);
    // The invoice survived — 1 cover + 2 invoice pages.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });

  it('produces a valid PDF even with nothing in it at all', async () => {
    const { bytes, missing } = await buildPacket({}, {});
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    expect(missing).toHaveLength(SECTIONS.length);
  });
});

describe('packetFileName', () => {
  it('names the file after the job', () => {
    expect(packetFileName({ sr: '2026024', customer: 'Flagstone Foods' }))
      .toBe('Job Packet 2026024 - Flagstone Foods.pdf');
  });

  it('strips characters a filesystem would object to', () => {
    expect(packetFileName({ sr: '2026/024', customer: "Reser's" })).not.toMatch(/[/']/);
  });

  it('still returns something usable with no metadata', () => {
    expect(packetFileName({})).toBe('Job Packet untitled.pdf');
  });
});

describe('packetEmail', () => {
  it('addresses every AP address and states the job', () => {
    const e = packetEmail(
      { customer: 'Flagstone Foods', invoiceNumber: '2026024', sr: '2026024', amount: 7379.2 },
      ['ap@flagstone.com', 'billing@flagstone.com'],
    );
    expect(e.to).toBe('ap@flagstone.com,billing@flagstone.com');
    expect(e.subject).toContain('2026024');
    expect(e.body).toContain('Flagstone Foods');
    expect(e.body).toContain('$7,379.2');
    expect(e.href.startsWith('mailto:')).toBe(true);
  });

  it('drops rows it has no value for rather than printing blanks', () => {
    const e = packetEmail({ customer: 'X' }, ['a@b.c']);
    expect(e.body).not.toMatch(/Invoice:\s*$/m);
    expect(e.body).not.toContain('Amount:');
  });

  it('survives having no recipients — the packet still builds', () => {
    expect(packetEmail({}, []).to).toBe('');
  });
});

describe('wrapText', () => {
  it('breaks a long note instead of letting it run off the page', async () => {
    const d = await PDFDocument.create();
    const font = await d.embedFont(StandardFonts.Helvetica);
    const lines = wrapText('word '.repeat(60), font, 10, 200);
    expect(lines.length).toBeGreaterThan(1);
    lines.forEach((l) => expect(font.widthOfTextAtSize(l, 10)).toBeLessThanOrEqual(200));
  });

  it('has nothing to say about nothing', () => {
    expect(wrapText('', null, 10, 200)).toEqual([]);
  });
});
