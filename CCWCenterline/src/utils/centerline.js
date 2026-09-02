// The centerline document, and how a value gets into it.
//
// A centerline is the sheet that tells a customer what a machine's settings
// SHOULD be for a given product, so an operator can compare it against the live
// unit. It is a specification, not a record of what the machine was doing — the
// document says so on its face, because a page of RCU screens showing values is
// otherwise indistinguishable from a capture of a running machine.
//
// A section is one screen's worth of settings, and comes in two shapes:
//
//   kind: 'mapped' — one of the RCU screens we hold artwork for. Values are
//                    keyed by the field keys in rcu-fields.json and are drawn
//                    into the real screen's own boxes.
//   kind: 'photo'  — a screen photographed on site, straightened, with its
//                    values listed beside it. This is the path for RCU
//                    generations whose artwork we do not have, which includes
//                    every newer unit.
//
// Values are strings throughout, deliberately. "90.0" must not become 90 on a
// document where the decimal is part of the specification, and plenty of RCU
// settings are not numbers at all ("1:1Mix", "2:Slave", "Off").

export const SOURCES = {
  typed: 'Typed in',
  imported: 'Imported from the machine',
  photo: 'Read from a photo',
  copied: 'Copied from a previous centerline',
};

/**
 * A label reduced to something two spellings of the same setting share.
 *
 * The same setting is printed differently depending on where you read it: the
 * screen says "Auto Zero Tolerance", the text export says "AUTO ZERO TOL.",
 * and a photo read gives whatever is actually on the panel. Case, spacing,
 * punctuation and trailing dots are all noise; the letters and digits are not.
 */
export const normalizeLabel = (label) =>
  String(label || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Where a shortened export label cannot be reached from the screen label by
// normalizing alone. Keyed by the normalized EXPORT spelling.
const ALIASES = {
  autozerotol: 'autozerotolerance',
  autozerointvl: 'autozerointerval',
  emptyjudgwt: 'emptyjudgmentweight',
  stablewt: 'stablejudgmentweight',
  stablecnt: 'stablecount',
  targetwt: 'targetweight',
  dischprioritycount: 'dischprioritycount',
};

const canonical = (label) => {
  const n = normalizeLabel(label);
  return ALIASES[n] || n;
};

/**
 * Match a printed label to a field in a screen's map.
 *
 * Exact-after-normalizing only. A fuzzy match here would quietly attach a
 * value to the wrong setting, which is the one failure this whole document
 * cannot survive — an unmatched value is offered to the engineer to place by
 * hand instead.
 */
export function matchField(label, fields) {
  const want = canonical(label);
  return fields.find((f) => canonical(f.label) === want) || null;
}

/**
 * Fold a set of {label, value} readings into one mapped section.
 *
 * Returns the values that matched and, separately, the ones that did not.
 * Unmatched readings are never dropped silently: they are shown to the
 * engineer, because a setting the machine reports and the document omits is
 * exactly the kind of gap nobody notices.
 */
export function applyReadings(readings, fields) {
  const values = {};
  const unmatched = [];
  for (const reading of readings || []) {
    const field = matchField(reading.label, fields);
    if (field) values[field.key] = String(reading.value ?? '').trim();
    else unmatched.push(reading);
  }
  return { values, unmatched };
}

export const emptyCenterline = () => ({
  version: 1,
  id: `cl_${Date.now().toString(36)}`,
  customer: '',
  plant: '',
  machine: '',
  line: '',
  product: '',
  presetNo: '',
  engineer: '',
  date: new Date().toISOString().slice(0, 10),
  notes: '',
  sections: [],
});

export const mappedSection = (slug, values = {}, source = 'typed') => ({
  kind: 'mapped', slug, values, source,
});

export const photoSection = (title, image, fields = [], source = 'photo') => ({
  kind: 'photo', title, image, fields, source,
});

/** Every value on the document, flattened for the summary table. */
export function settingsTable(centerline, spec) {
  const rows = [];
  for (const section of centerline.sections || []) {
    if (section.kind === 'mapped') {
      const screen = spec.screens[section.slug];
      if (!screen) continue;
      for (const field of screen.fields) {
        const value = section.values?.[field.key];
        if (value === undefined || value === '') continue;
        rows.push({
          section: screen.title, label: field.label, value,
          unit: field.unit || '', source: section.source,
        });
      }
    } else {
      for (const field of section.fields || []) {
        if (!field.value) continue;
        rows.push({
          section: section.title || 'Photographed screen',
          label: field.label, value: field.value, unit: '',
          source: section.source, confident: field.confident !== false,
        });
      }
    }
  }
  return rows;
}

/**
 * What is missing, so the engineer sees it before the customer does.
 *
 * A blank on a specification reads as "set it to nothing" rather than "we did
 * not record this", so the document lists its own gaps rather than leaving
 * them to be discovered on a plant floor.
 */
export function gaps(centerline, spec) {
  const out = [];
  for (const section of centerline.sections || []) {
    if (section.kind !== 'mapped') continue;
    const screen = spec.screens[section.slug];
    if (!screen) continue;
    const missing = screen.fields
      .filter((f) => !f.disabledOnScreen)
      .filter((f) => !section.values?.[f.key])
      .map((f) => f.label);
    if (missing.length) out.push({ screen: screen.title, missing });
  }
  return out;
}

/** A copy of a centerline ready to be edited as a new one. */
export function copyFrom(previous) {
  return {
    ...structuredClone(previous),
    id: `cl_${Date.now().toString(36)}`,
    date: new Date().toISOString().slice(0, 10),
    sections: (previous.sections || []).map((s) => ({ ...structuredClone(s), source: 'copied' })),
  };
}
