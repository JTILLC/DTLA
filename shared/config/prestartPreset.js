// shared/config/prestartPreset.js
//
// The daily pre-start check, as a thing of its own.
//
// These items already existed as one section inside the PM checklist, which is
// where they belong on paper and the wrong place in an app. PM is maintenance
// work — span checks, crack inspections, fuse ratings, battery replacement
// intervals — and it opens with all of that on screen. An operator who only has
// to walk the machine before a shift had to go into the maintenance screen and
// pick the right section out of it, which is both slower and an invitation to
// tick something that was not theirs to tick.
//
// So the pre-start list is its own page, its own template and its own log. Same
// items, a screen with nothing else on it.
//
// Source: CCW-R _2XX manual, ch.10.2.1 "Inspection before operation".
export const PRESTART_PRESET = {
  id: 'ishida-ccw-r-prestart',
  name: 'Ishida CCW-R — before production (10.2.1)',
  items: [
    { label: 'Weigher and vicinity — no tools or loose items on or above the machine', type: 'check' },
    { label: 'Dispersion table securely mounted, no play or rocking', type: 'check' },
    { label: 'Dispersion table not touching the radial troughs', type: 'check', imageUrl: '/pm-manual/fig-10-1-dispersion-table.png' },
    { label: 'Radial troughs not touching each other', type: 'check', imageUrl: '/pm-manual/fig-10-2-radial-trough.png' },
    { label: 'Every hopper roller fully seated in the U-groove of its open/close lever', type: 'check' },
    { label: 'Collection chutes properly mounted', type: 'check' },
    { label: 'Timing hopper fully joined to the drive unit by the drive lever', type: 'check' },
  ],
};

// Fresh ids each time: item ids key the answers while a check is being filled
// in, so two lists minted from the same preset must not share them.
export const presetItems = (preset = PRESTART_PRESET, now = Date.now()) =>
  (preset.items || []).map((it, i) => ({
    id: `pre_${now}_${i}`,
    label: it.label,
    type: it.type || 'check',
    ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}),
  }));

export default { PRESTART_PRESET, presetItems };
