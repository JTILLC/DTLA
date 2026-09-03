// Reading Preset.prm, the RCU's binary preset store.
//
// The text exports the Output button writes cover the machine blocks; the
// presets themselves - target weights, timing, feeder values - are only in
// this binary, which sits one folder up in a backup (`cw/Preset.prm`).
//
// A port of tools/parse_preset.py, which is the reference and carries the
// full account of how the layout was worked out: one real file from a 32-head
// six-section mix weigher on an RCU W0530G, checked against the preset
// printout example in the CCW-R-2** instruction manual, whose defaults match
// the file's unused sections byte for byte. Everything is big-endian.
//
// What is confirmed there is presented plainly; what is only a well-supported
// reading is marked with a trailing `?` in its label and flagged `check` on
// the document, exactly like an uncertain photo read.

export const RECORD = 2892;
export const COUNT = 200;
const HEADS = 32;
const SECTIONS = 8;
const FEEDER_SET = 292;
export const PRESET_FILE_SIZE = RECORD * COUNT;

export const isPresetFile = (file) =>
  /\.prm$/i.test(file.name) && file.size === PRESET_FILE_SIZE;

const text = (dv, o, n) => {
  let s = '';
  for (let i = 0; i < n; i += 1) {
    const c = dv.getUint8(o + i);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
};

/** A 32-bit head mask as the RCU prints it: "12-16". 0xffff means none. */
export function headsOf(mask) {
  if (mask === 0 || mask === 0xffff || mask === 0xffffffff) return '';
  const heads = [];
  for (let h = 0; h < HEADS; h += 1) if ((mask >>> h) & 1) heads.push(h + 1);
  const runs = [];
  let start = heads[0];
  let prev = heads[0];
  for (const h of heads.slice(1).concat([null])) {
    if (h !== prev + 1) {
      runs.push(start === prev ? String(start) : `${start}-${prev}`);
      start = h;
    }
    prev = h;
  }
  return runs.join(',');
}

function feederSet(dv, o) {
  const out = { written: dv.getUint32(o) !== 0xffffffff, afd: [], rf: [], df: [], dfInfeed: [] };
  let p = o + 4;
  for (let i = 0; i < SECTIONS; i += 1) {
    out.afd.push({
      autoAmpMax: dv.getUint8(p + 8), autoAmpMin: dv.getUint8(p + 9),
      autoTimeMax: dv.getUint8(p + 10), autoTimeMin: dv.getUint8(p + 11),
    });
    p += 12;
  }
  for (let i = 0; i < HEADS; i += 1) { out.rf.push({ amp: dv.getUint8(p), time: dv.getUint8(p + 1) }); p += 2; }
  for (let i = 0; i < SECTIONS; i += 1) { out.df.push({ amp: dv.getUint8(p), time: dv.getUint8(p + 1) }); p += 2; }
  p += 4 * SECTIONS; // DF ranges: not decoded
  for (let i = 0; i < SECTIONS; i += 1) {
    out.dfInfeed.push({
      infeedWt: dv.getUint16(p), upperPct: dv.getUint8(p + 2), lowerPct: dv.getUint8(p + 3),
      afdUpperWt: dv.getUint16(p + 4), afdLowerWt: dv.getUint16(p + 6), afdStopLowerWt: dv.getUint8(p + 8),
    });
    p += 10;
  }
  if (p !== o + FEEDER_SET) throw new Error('feeder set size');
  return out;
}

const weights = (dv, o) => ({
  target: dv.getUint16(o + 0x0a) / 10,
  upper: dv.getUint16(o + 0x0c) / 10,
  tolNegErr: dv.getUint16(o + 0x0e) / 10,
  exUpper: dv.getUint16(o + 0x10) / 10,
});

export function parseRecord(dv, base, index) {
  const r = { no: index + 1, name: text(dv, base + 0x08, 24), code: text(dv, base + 0x21, 23), sections: [] };
  for (let k = 0; k < SECTIONS; k += 1) {
    const o = base + 0xa4 + 16 * k;
    const t = (i) => dv.getUint8(o + 4 + i) * 10;
    r.sections.push({
      heads: headsOf(dv.getUint32(o)),
      timing: { 'WH-PH': t(0), 'PH-RF': t(1), 'WH-BH': t(2), 'BH-WH': t(3),
        'WH delay?': t(4), 'Stagger?': t(5), 'WH on?': t(6), 'PH on?': t(7), 'BH on?': t(8) },
    });
  }
  r.feeder = feederSet(dv, base + 0x13c);
  r.feederOptimum = feederSet(dv, base + 0x320);
  for (let k = 0; k < SECTIONS; k += 1) {
    const o = base + 0x510 + 136 * k;
    Object.assign(r.sections[k], weights(dv, o), {
      autoFeedTarget: dv.getUint8(o + 0x1a) / 10,
      priority: dv.getUint8(o + 0x24),
      feederMultiply: dv.getUint8(o + 0x25),
      goodEfficiency: dv.getUint16(o + 0x64) / 10,
    });
  }
  const o = base + 0x950;
  r.total = { ...weights(dv, o), speed: dv.getUint16(o + 0x18), dumpCount: dv.getUint8(o + 0x1a),
    avControl: dv.getUint8(o + 0x21), sectSet: dv.getUint8(o + 0x27) };
  for (let k = 0; k < SECTIONS; k += 1) {
    const p = base + 0x978 + 48 * k;
    r.sections[k].prodName = text(dv, p, 25);
    r.sections[k].prodCode = text(dv, p + 25, 23);
  }
  const b = (i) => dv.getUint8(base + 0xb18 + i);
  const two = (n) => String(n).padStart(2, '0');
  r.modified = b(1) ? `20${two(b(0))}-${two(b(1))}-${two(b(2))} ${two(b(5))}:${two(b(6))}:${two(b(7))}` : '';
  return r;
}

/** Every named preset in a Preset.prm. */
export function parsePresets(buffer) {
  if (buffer.byteLength !== PRESET_FILE_SIZE) {
    throw new Error(`Preset.prm is ${buffer.byteLength} bytes; expected ${PRESET_FILE_SIZE}`);
  }
  const dv = new DataView(buffer);
  const out = [];
  for (let i = 0; i < COUNT; i += 1) {
    const r = parseRecord(dv, i * RECORD, i);
    if (r.name) out.push(r);
  }
  return out;
}

const g = (n) => `${n.toFixed(1)} g`;
const ms = (n) => `${n} ms`;

/** The sections that carry anything: heads, a product, or a target. */
const liveSections = (p) => p.sections.filter((s) => s.heads || s.prodName || s.target);

/**
 * A preset as import blocks, the same shape parseExport returns, so the
 * importer lists, filters and places them exactly like the text exports.
 *
 * Four blocks: Product (the whole-preset settings), Sections, Timing, Feeder;
 * a fifth for the optimum values when they were ever written. Labels are the
 * mapped screens' own wording where a setting exists there, so a value can be
 * placed straight onto the Weight Setting or Item screen. Readings that are
 * not proven carry a `?` and are listed in `unsure`.
 */
export function presetBlocks(p) {
  const key = `Preset ${p.no}`;
  const live = liveSections(p);
  const single = live.length <= 1;
  const unsure = [];
  const q = (label) => { unsure.push(label); return label; };
  const blocks = {};

  const product = { title: `${key} · ${p.name}`, values: {}, groups: {}, unsure };
  const v = product.values;
  v['Product Name'] = p.name;
  v['Product Code'] = p.code;
  v['Target Weight'] = g(p.total.target);
  v['Upper Weight Limit'] = g(p.total.upper);
  v[q('Tolerance Negative Error?')] = g(p.total.tolNegErr);
  v[q('Extended Upper Limit?')] = g(p.total.exUpper);
  v[q('Speed?')] = `${p.total.speed} bpm`;
  v[q('Dump Count?')] = String(p.total.dumpCount);
  v[q('Average Control?')] = p.total.avControl ? 'On' : 'Off';
  v[q('Section Parameter Number?')] = String(p.total.sectSet);
  if (single && live[0]) {
    const s = live[0];
    v['Auto Feed Target'] = String(s.autoFeedTarget);
    v['Disch. Priority Count'] = String(s.priority);
    v['Feed Multiplier'] = String(s.feederMultiply);
    v['Good Efficiency Judgement Value'] = `${s.goodEfficiency.toFixed(1)}%`;
  }
  v['Last modified on the RCU'] = p.modified;
  blocks[`${key} Product`] = product;

  const sectionRows = (s) => ({
    Heads: s.heads, 'Product Name': s.prodName, 'Product Code': s.prodCode,
    'Target Weight': g(s.target), 'Upper Weight Limit': g(s.upper),
    [q('Tolerance Negative Error?')]: g(s.tolNegErr), [q('Extended Upper Limit?')]: g(s.exUpper),
    'Auto Feed Target': String(s.autoFeedTarget), 'Disch. Priority Count': String(s.priority),
    'Feed Multiplier': String(s.feederMultiply),
    'Good Efficiency Judgement Value': `${s.goodEfficiency.toFixed(1)}%`,
  });
  if (!single) {
    const sections = { title: `${key} · Sections`, values: {}, groups: {}, unsure };
    p.sections.forEach((s, i) => { if (live.includes(s)) sections.groups[`S${i + 1}`] = sectionRows(s); });
    blocks[`${key} Sections`] = sections;
  }

  const timing = { title: `${key} · Timing`, values: {}, groups: {}, unsure };
  const timingRows = (s) => Object.fromEntries(
    Object.entries(s.timing).map(([k, n]) => [k.endsWith('?') ? q(k) : k, ms(n)]),
  );
  if (single) Object.assign(timing.values, timingRows(live[0] || p.sections[0]));
  else p.sections.forEach((s, i) => { if (live.includes(s)) timing.groups[`S${i + 1}`] = timingRows(s); });
  blocks[`${key} Timing`] = timing;

  const feederBlock = (title, f) => {
    const block = { title, values: {}, groups: {}, unsure };
    const rf = {};
    f.rf.forEach((h, i) => { rf[`RF ${i + 1} amplitude`] = String(h.amp); rf[`RF ${i + 1} time`] = String(h.time); });
    block.groups.RF = rf;
    const dfCount = Math.max(live.length, 1);
    const df = {};
    f.df.slice(0, dfCount).forEach((d, i) => { df[`DF ${i + 1} amplitude`] = String(d.amp); df[`DF ${i + 1} time`] = String(d.time); });
    block.groups.DF = df;
    for (let i = 0; i < dfCount; i += 1) {
      const a = f.afd[i];
      const d = f.dfInfeed[i];
      block.groups[`DF ${i + 1} infeed`] = {
        'Infeed weight': `${d.infeedWt} g`, 'Upper': `+${d.upperPct}%`, 'Lower': `-${d.lowerPct}%`,
        'AFD DF upper weight': `${d.afdUpperWt} g`, 'AFD DF lower weight': `${d.afdLowerWt} g`,
        'AFD stop DF lower weight': `${d.afdStopLowerWt} g`,
        'AFD auto amplitude min': String(a.autoAmpMin), 'AFD auto amplitude max': String(a.autoAmpMax),
        'AFD auto time min': String(a.autoTimeMin), 'AFD auto time max': String(a.autoTimeMax),
      };
    }
    return block;
  };
  blocks[`${key} Feeder`] = feederBlock(`${key} · Feeder`, p.feeder);
  if (p.feederOptimum.written) {
    blocks[`${key} Feeder optimum`] = feederBlock(`${key} · Feeder optimum values`, p.feederOptimum);
  }
  return blocks;
}

/**
 * The same blocks with nothing in them, for a preset written down by hand on
 * a machine we cannot read: every setting named, every value blank.
 */
export function blankPresetBlocks(heads = 14, sectionCount = 1) {
  const blank = (labels) => Object.fromEntries(labels.map((l) => [l, '']));
  const single = sectionCount <= 1;
  const blocks = {};
  const productLabels = ['Product Name', 'Product Code', 'Target Weight', 'Upper Weight Limit',
    'Lower Weight Limit', 'Extended Upper Limit', 'Extended Upper Limit Dump Cycle', 'Speed',
    'Dump Count', 'Average Control', 'Interlock Parameter Number', 'Section Parameter Number',
    'Stable Time'];
  const itemLabels = ['Auto Feed Target', 'Disch. Priority Count', 'Feed Multiplier',
    'Good Efficiency Judgement Value', 'Hopper Action Parameter Number', 'Photo SW', 'Shutter Drive'];
  blocks['Preset Product'] = {
    title: 'Preset · Product', groups: {}, unsure: [],
    values: blank(single ? productLabels.concat(itemLabels) : productLabels),
  };
  const sectionLabels = ['Heads', 'Product Name', 'Product Code', 'Target Weight', 'Upper Weight Limit',
    'Lower Weight Limit', 'Extended Upper Limit'].concat(itemLabels);
  if (!single) {
    const groups = {};
    for (let i = 1; i <= sectionCount; i += 1) groups[`S${i}`] = blank(sectionLabels);
    blocks['Preset Sections'] = { title: 'Preset · Sections', values: {}, groups, unsure: [] };
  }
  const timingLabels = ['WH-DS', 'IS-WH', 'WH-PH', 'PH-RF', 'WH-BH', 'BH-WH', 'WH delay', 'Stagger',
    'WH on', 'PH on', 'BH on'];
  const timing = { title: 'Preset · Timing', values: {}, groups: {}, unsure: [] };
  if (single) timing.values = blank(timingLabels);
  else for (let i = 1; i <= sectionCount; i += 1) timing.groups[`S${i}`] = blank(timingLabels);
  blocks['Preset Timing'] = timing;
  const feeder = { title: 'Preset · Feeder', values: {}, groups: {}, unsure: [] };
  const rf = [];
  for (let i = 1; i <= heads; i += 1) rf.push(`RF ${i} amplitude`, `RF ${i} time`);
  feeder.groups.RF = blank(rf);
  const df = [];
  for (let i = 1; i <= sectionCount; i += 1) df.push(`DF ${i} amplitude`, `DF ${i} time`);
  feeder.groups.DF = blank(df);
  blocks['Preset Feeder'] = feeder;
  return blocks;
}
