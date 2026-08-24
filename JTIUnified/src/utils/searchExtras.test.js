// The one box has to find receipts and customer records, not just jobs.
import { describe, it, expect } from 'vitest';
import { matchPackets, matchCustomerRecords, matchReservedJobs } from './searchExtras.js';

// Stands in for the caller's matcher — the real one also handles "WH1"/"WH 1",
// which is exactly why these take a predicate instead of comparing themselves.
const contains = (term) => (v) => String(v).toLowerCase().includes(term.toLowerCase());

const packets = [
  {
    sr: '2026024',
    notes: 'Waiting on the PO',
    files: [
      { name: 'shell.jpg', kind: 'receipts', vendor: 'Shell', category: 'Fuel', amount: '62.40' },
      { name: 'invoice-2026024.pdf', kind: 'invoice' },
    ],
  },
  { sr: '2026018', files: [{ name: 'hertz.pdf', kind: 'receipts', vendor: 'Hertz', category: 'Car rental' }] },
  { sr: '2026001', files: [] },
];

describe('matchPackets', () => {
  it('finds a packet by its service report number', () => {
    const r = matchPackets(packets, contains('2026018'));
    expect(r.map((x) => x.sr)).toEqual(['2026018']);
  });

  it('finds a job by the VENDOR on a receipt inside it', () => {
    // The whole point: "where did that Hertz charge go?" should answer.
    const r = matchPackets(packets, contains('hertz'));
    expect(r).toHaveLength(1);
    expect(r[0].sr).toBe('2026018');
    expect(r[0].files[0].vendor).toBe('Hertz');
  });

  it('names the matching file, not just the packet', () => {
    const r = matchPackets(packets, contains('shell'));
    expect(r[0].files.map((f) => f.name)).toEqual(['shell.jpg']);
  });

  it('finds by expense type', () => {
    expect(matchPackets(packets, contains('car rental')).map((x) => x.sr)).toEqual(['2026018']);
  });

  it('finds by a note on the packet', () => {
    const r = matchPackets(packets, contains('waiting on the po'));
    expect(r[0].sr).toBe('2026024');
    expect(r[0].files).toEqual([]);   // matched the packet, not a file
  });

  it('returns nothing rather than everything when nothing matches', () => {
    expect(matchPackets(packets, contains('zzzz'))).toEqual([]);
  });

  it('survives packets with no files and junk in the list', () => {
    expect(() => matchPackets([null, undefined, {}], contains('x'))).not.toThrow();
  });
});

const records = [
  {
    name: 'Flagstone Foods',
    profile: {
      address: '123 Mill Rd', city: 'Robersonville', state: 'NC',
      contacts: [{ name: 'Dale Hutchins', email: 'dale@flagstone.example', role: 'Maintenance' }],
      invoiceEmails: ['ap@flagstone.example'],
    },
  },
  { name: 'Oasis Date', profile: { city: 'Coachella', state: 'CA', invoiceEmails: ['payables@oasis.example'] } },
];

describe('matchCustomerRecords', () => {
  it('finds a customer by name', () => {
    expect(matchCustomerRecords(records, contains('flagstone')).map((r) => r.name)).toEqual(['Flagstone Foods']);
  });

  it('finds the customer a CONTACT belongs to', () => {
    const r = matchCustomerRecords(records, contains('dale hutchins'));
    expect(r[0].name).toBe('Flagstone Foods');
    expect(r[0].matches.some((m) => m.field === 'Contact')).toBe(true);
  });

  it('finds the customer an AP email belongs to', () => {
    // "Who is payables@oasis.example?" is a question this directory should
    // answer — it is most of the reason the invoice emails are recorded.
    const r = matchCustomerRecords(records, contains('payables@oasis'));
    expect(r[0].name).toBe('Oasis Date');
    expect(r[0].matches[0].field).toBe('Invoice email');
  });

  it('finds by city, which is what tells two plants of one customer apart', () => {
    expect(matchCustomerRecords(records, contains('coachella')).map((r) => r.name)).toEqual(['Oasis Date']);
  });

  it('survives records with no profile', () => {
    expect(() => matchCustomerRecords([null, { name: 'X' }], contains('x'))).not.toThrow();
    expect(matchCustomerRecords([{ name: 'X' }], contains('x'))).toHaveLength(1);
  });
});

// A reserved number is findable everywhere EXCEPT the search box, because
// search read the tracker's jobs and reservations live somewhere else. That
// gap made a reserved number look like it did not exist — and the obvious
// next move on "it does not exist" is to reserve it again.
describe('matchReservedJobs', () => {
  const norm = (v) => String(v ?? '').trim().replace(/[\s-]/g, '').toUpperCase();
  const reserved = [
    { sr: '2026028', customer: 'suntree', city: 'Phoenix', description: 'Weigher service' },
    { sr: '2026031', customer: 'Utz', city: 'Hanover' },
  ];

  it('finds a reserved number the tracker has never heard of', () => {
    const out = matchReservedJobs(reserved, [], contains('2026028'), norm);
    expect(out).toHaveLength(1);
    expect(out[0].sr).toBe('2026028');
    // Flagged, so the row can say it is a reservation rather than showing a
    // paid/unpaid badge for an invoice that does not exist.
    expect(out[0].reservedOnly).toBe(true);
    expect(out[0].matchedFields.some((m) => m.field === 'Service report')).toBe(true);
  });

  it('does not list a job the tracker already returned', () => {
    const tracker = [{ sr: '2026028', customer: 'SunTree' }];
    expect(matchReservedJobs(reserved, tracker, contains('2026028'), norm)).toHaveLength(0);
  });

  it('treats 2026-028 and 2026028 as the same job', () => {
    const tracker = [{ sr: '2026-028' }];
    expect(matchReservedJobs(reserved, tracker, contains('2026028'), norm)).toHaveLength(0);
  });

  it('matches an older job whose number was only ever the invoice number', () => {
    const tracker = [{ invoiceNumber: '2026028' }];
    expect(matchReservedJobs(reserved, tracker, contains('2026028'), norm)).toHaveLength(0);
  });

  it('finds a reservation by customer, city or description too', () => {
    expect(matchReservedJobs(reserved, [], contains('suntree'), norm)).toHaveLength(1);
    expect(matchReservedJobs(reserved, [], contains('hanover'), norm)).toHaveLength(1);
    expect(matchReservedJobs(reserved, [], contains('weigher'), norm)).toHaveLength(1);
  });

  it('returns nothing rather than throwing on rubbish', () => {
    expect(() => matchReservedJobs([null, { sr: '' }], [null], contains('x'), norm)).not.toThrow();
    expect(matchReservedJobs(undefined, undefined, contains('x'), norm)).toEqual([]);
  });
});
