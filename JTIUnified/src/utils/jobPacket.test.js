// Assembling the packet. The failure that costs real money is a packet that
// looks complete and is not, so most of these are about what it SAYS is
// missing and about one bad file not taking the invoice down with it.
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  SECTIONS, buildPacket, missingSections, describeUnsupported,
  packetFileName, packetEmail, wrapText, parseAmount, receiptsTotal, money,
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
    expect(missingSections({})).toEqual(['Invoice', 'Purchase order', 'Service report', 'Receipts']);
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
  it('merges every part in the order accounts payable reads', async () => {
    const parts = {
      po: await part('po.pdf', 1),
      invoice: await part('invoice.pdf', 2),
      serviceReport: await part('sr.pdf', 3),
      receipts: [await part('r1.pdf', 1), await part('r2.pdf', 1)],
    };
    const { bytes, problems, missing } = await buildPacket({ sr: '2026024', customer: 'Flagstone Foods' }, parts);
    const out = await PDFDocument.load(bytes);
    // invoice(2) + PO + service report(3) + receipts list + 2 receipts.
    // No cover sheet: the invoice leads.
    expect(out.getPageCount()).toBe(2 + 1 + 3 + 1 + 2);
    expect(problems).toEqual([]);
    expect(missing).toEqual([]);
  });

  it('still produces a packet when parts are missing, and says which', async () => {
    const { bytes, missing } = await buildPacket({ sr: '2026024' }, { invoice: await part('i.pdf') });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1); // the invoice alone
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
    // The invoice survived — 2 invoice pages + the receipts list. The broken
    // receipt is listed and simply has no image behind it.
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  });

  it('produces a valid PDF even with nothing in it at all', async () => {
    // Nothing in, nothing out — but still a valid PDF rather than a crash.
    // pdf-lib normalises a document with no pages to one blank page on save,
    // which is its doing rather than a cover sheet sneaking back in.
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

// The money. A total that is quietly wrong is worse than one that is missing:
// it gets sent to a customer and paid, or queried, and either way somebody
// re-adds nine photographs by hand to find out which figure was off.
describe('parseAmount', () => {
  it('reads the ways people actually type money', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('1234.56')).toBe(1234.56);
    expect(parseAmount('12')).toBe(12);
    expect(parseAmount(42.5)).toBe(42.5);
  });

  it('treats an unreadable amount as zero rather than poisoning the total', () => {
    // One figure nobody typed must cost that figure, not the whole sum.
    expect(parseAmount('')).toBe(0);
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
    expect(parseAmount('n/a')).toBe(0);
    expect(parseAmount(NaN)).toBe(0);
  });

  it('keeps a negative — a credit on a receipt is real', () => {
    expect(parseAmount('-25.00')).toBe(-25);
  });
});

describe('receiptsTotal', () => {
  it('adds what is there and ignores what is not', () => {
    expect(receiptsTotal([{ amount: '42.10' }, { amount: '$7.90' }, { amount: '' }])).toBeCloseTo(50, 2);
  });

  it('is zero for nothing', () => {
    expect(receiptsTotal([])).toBe(0);
    expect(receiptsTotal()).toBe(0);
  });
});

describe('money', () => {
  it('always shows two decimals, so a column of figures lines up', () => {
    expect(money(12)).toBe('$12.00');
    expect(money('7.5')).toBe('$7.50');
    expect(money(1234.5)).toBe('$1,234.50');
  });
});

describe('buildPacket with priced receipts', () => {
  it('adds an itemised page and reports the total', async () => {
    const parts = {
      invoice: await part('invoice.pdf', 1),
      receipts: [
        { ...(await part('fuel.pdf', 1)), amount: '42.10', vendor: 'Shell' },
        { ...(await part('parts.pdf', 1)), amount: '$107.90', vendor: 'Grainger' },
      ],
    };
    const res = await buildPacket({ sr: '2026030' }, parts);
    expect(res.receiptsTotal).toBeCloseTo(150, 2);
    // invoice + expenses page + two receipts
    expect((await PDFDocument.load(res.bytes)).getPageCount()).toBe(4);
  });

  it('LISTS an unpriced receipt rather than pricing it at zero', async () => {
    // "$0.00" against a receipt tells accounts payable it was free. The list
    // has to say "not priced" so somebody asks — and it must appear even when
    // nothing is priced, which is exactly when it is most needed.
    const parts = { receipts: [await part('r.pdf', 1)] };
    const res = await buildPacket({ sr: 'x' }, parts);
    expect(res.receiptsTotal).toBe(0);
    expect((await PDFDocument.load(res.bytes)).getPageCount()).toBe(2); // list + receipt
  });
});
