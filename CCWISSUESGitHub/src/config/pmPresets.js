// src/config/pmPresets.js
//
// The manufacturer's own maintenance schedule, as a checklist you can add to a
// customer's PM template.
//
// Taken from the Ishida CCW-R _2XX manual, chapter 10 "Periodic Maintenance":
// Table 10-1 (pre-startup) and Table 10-4 (periodic inspection list). Section
// numbers are kept on each item so anyone can find the procedure and the
// figures in the manual rather than relying on the one-line summary here.
//
// Why a preset and not a hardcoded checklist
// -----------------------------------------
// Plants differ — different options fitted, different house rules, different
// things that have bitten them before. This is a starting point that gets
// ADDED to whatever a site already has, never a replacement for it, so the
// items JTI or the plant wrote for their own reasons survive.
//
// Frequencies live in the section titles because the app's PM log is a single
// submission per check, not a per-item scheduler. Grouping by interval is what
// lets an operator run only the part that is due.
//
// The manual's figures ship with the app under /pm-manual/ and are referenced
// by URL, NOT copied into a customer's storage. They are the same drawing for
// every CCW-R, so per-customer copies would be identical files multiplied by
// the number of plants — and each would then need the media broker's
// per-customer authorisation for something that is not customer data at all.
//
// That is why an item has EITHER `imageUrl` (a manual figure, shipped) or the
// uploaded `image` (a photo of this plant's own machine). Both can coexist on a
// checklist; only the uploaded one is per-customer.

export const PM_PRESETS = [
  {
    id: 'ishida-ccw-r',
    name: 'Ishida CCW-R — manual schedule',
    source: 'CCW-R _2XX manual, ch.10 Periodic Maintenance',
    sections: [
      {
        title: 'Pre-start checks (before production) — manual 10.2.1',
        items: [
          { label: 'Weigher and vicinity — no tools or loose items on or above the machine', type: 'check' },
          { label: 'Dispersion table securely mounted, no play or rocking', type: 'check' },
          { label: 'Dispersion table not touching the radial troughs (fig. 10-1)', type: 'check', imageUrl: '/pm-manual/fig-10-1-dispersion-table.png' },
          { label: 'Radial troughs not touching each other (fig. 10-2)', type: 'check', imageUrl: '/pm-manual/fig-10-2-radial-trough.png' },
          { label: 'Every hopper roller fully seated in the U-groove of its open/close lever', type: 'check' },
          { label: 'Collection chutes properly mounted', type: 'check' },
          { label: 'Timing hopper fully joined to the drive unit by the drive lever', type: 'check' },
        ],
      },
      {
        title: 'Monthly — manual 10.3',
        items: [
          { label: 'Span check — zero each hopper, confirm 0.0 ±0.1 g (10.3.1)', type: 'check' },
          { label: 'Span check — 200 g weight on each hopper, confirm 200.0 ±0.1 g (10.3.1)', type: 'check' },
          { label: 'Hopper gates open and close smoothly, no stagger; bush at each gate pivot not worn (10.3.3)', type: 'check', imageUrl: '/pm-manual/fig-10-18-pool-hopper-roller.png' },
          { label: 'Open/close roller of each hopper turns freely — no lopsided wear, not dirty (10.3.4)', type: 'check', imageUrl: '/pm-manual/fig-10-19-weigh-hopper-roller.png' },
          { label: 'Radial feeder amplitude — equal feeder time on all heads, product conveying evenly (10.3.5)', type: 'check' },
          { label: 'Heads outside tolerance after span check (leave blank if none)', type: 'value' },
        ],
      },
      {
        title: 'Annually — manual 10.3',
        items: [
          { label: 'Crack check — pool hoppers, weigh hoppers and radial troughs (10.3.6, fig. 10-20)', type: 'check', imageUrl: '/pm-manual/fig-10-20-crack-points.png' },
          { label: 'Rubber covers on radial troughs — no wear, distortion or cracking (10.3.7)', type: 'check', imageUrl: '/pm-manual/fig-10-21-rubber-cover.png' },
        ],
      },
      {
        title: 'Long interval / as needed — manual 10.3',
        items: [
          { label: 'Memory backup battery — replace approx. every 5 years, Ishida service only (10.3.8)', type: 'check' },
          { label: 'Fuses intact — AC board P-5507, DC board P-5508; 250V 5A and 250V 3.15A (10.3.9)', type: 'check' },
          { label: 'Date battery last replaced', type: 'value' },
        ],
      },
    ],
  },
];

// Fresh ids, because item ids key answers while a check is being filled in —
// two sections sharing an id would let one operator's answers bleed into another's.
export function presetSections(preset) {
  const stamp = Date.now();
  return (preset?.sections || []).map((sec, si) => ({
    id: `sec_${stamp}_${si}`,
    title: sec.title,
    items: (sec.items || []).map((it, ii) => ({
      id: `item_${stamp}_${si}_${ii}`,
      label: it.label,
      type: it.type || 'check',
      ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}),
    })),
  }));
}

export default { PM_PRESETS, presetSections };
