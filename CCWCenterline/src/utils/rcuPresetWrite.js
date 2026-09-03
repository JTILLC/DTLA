// Writing a preset back into Preset.prm.
//
// The inverse of rcuPreset.js: the preset blocks on the document, as the
// engineer left them, become one record in a copy of the customer's own
// backup. Every byte not written here stays exactly as the machine wrote it,
// which is the whole safety argument - the file has no checksum, so what
// goes back is the machine's file with a handful of known fields changed.
//
// Only fields whose position and unit are CONFIRMED are written (see
// tools/parse_preset.py for what that means). The readings the decoder marks
// with `?` - upper limit, tolerance, extended upper, speed, dump count,
// average control, section set - are deliberately left as they were in the
// slot. Writing a wrong upper limit into a running weigher is the one mistake
// this must not make; those get written once a restore on a real machine has
// shown which byte is which.

import { LAYOUTS, layoutFor, headsOf } from './rcuPreset.js';

const HEADS = 32;
const SECTIONS = 8; // the most any layout holds; a smaller layout ignores the rest

/** "12-16" or "2,4" -> the 32-bit mask; '' -> 0xffff, the file's "none". */
export function headMask(text) {
  const t = String(text || '').trim();
  if (!t) return 0xffff;
  let mask = 0;
  for (const part of t.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw new Error(`Heads "${t}" is not a range like 12-16`);
    const a = Number(m[1]);
    const b = Number(m[2] || m[1]);
    if (a < 1 || b > HEADS || a > b) throw new Error(`Heads "${t}" is outside 1-${HEADS}`);
    for (let h = a; h <= b; h += 1) mask |= 1 << (h - 1);
  }
  return mask >>> 0;
}

/** The number at the front of a value: "113.9 g" -> 113.9, "+50%" -> 50. */
export const num = (value) => {
  const m = String(value ?? '').trim().match(/^[+-]?\d+(\.\d+)?/);
  return m ? Math.abs(parseFloat(m[0])) : null;
};

/**
 * The document's preset blocks -> one partial preset.
 *
 * Reads the same labels presetBlocks() writes, so a preset can go file ->
 * document -> file untouched. Anything absent stays undefined and is left
 * alone in the record. Labels ending in `?` are ignored on purpose.
 */
export function presetFromSections(sections) {
  const p = { sections: [], rf: [], df: [], afd: [], dfInfeed: [], from: null };
  // Blocks decoded from a preset carry its number in their titles; a preset
  // written by hand does not. When they all agree, that record is the base.
  const numbers = new Set((sections || [])
    .filter((s) => s.kind === 'photo' && /^Preset(?: \d+)? · /.test(s.title || ''))
    .map((s) => (s.title.match(/^Preset (\d+) · /) || [])[1] || ''));
  if (numbers.size === 1 && !numbers.has('')) p.from = Number([...numbers][0]);
  const sec = (i) => (p.sections[i] ||= { timing: {} });
  const set = (obj, key, value) => { if (value !== null && value !== undefined && value !== '') obj[key] = value; };

  for (const section of sections || []) {
    const title = String(section.title || '');
    if (!/^Preset(?: \d+)? · /.test(title) || section.kind !== 'photo') continue;
    const block = title.replace(/^Preset(?: \d+)? · /, '');
    for (const field of section.fields || []) {
      const label = String(field.label || '').trim();
      if (label.endsWith('?')) continue;
      const value = String(field.value ?? '').trim();
      if (!value) continue;
      const parts = label.split(' › ').map((s) => s.trim());

      if (block === 'Timing') {
        const [group, name] = parts.length === 2 ? parts : ['S1', parts[0]];
        const i = Number((group.match(/^S(\d)$/) || [])[1]);
        if (i >= 1 && i <= SECTIONS && ['WH-PH', 'PH-RF', 'WH-BH', 'BH-WH'].includes(name)) {
          set(sec(i - 1).timing, name, num(value));
        }
        continue;
      }

      if (block === 'Sections' || (block !== 'Feeder' && !block.startsWith('Feeder') && parts.length === 2)) {
        const [group, name] = parts;
        const i = Number((group.match(/^S(\d)$/) || [])[1]);
        if (!(i >= 1 && i <= SECTIONS)) continue;
        const s = sec(i - 1);
        if (name === 'Heads') set(s, 'heads', value);
        else if (name === 'Product Name') set(s, 'prodName', value);
        else if (name === 'Product Code') set(s, 'prodCode', value);
        else if (name === 'Target Weight') set(s, 'target', num(value));
        else if (name === 'Auto Feed Target') set(s, 'autoFeedTarget', num(value));
        else if (name === 'Disch. Priority Count') set(s, 'priority', num(value));
        else if (name === 'Feed Multiplier') set(s, 'feederMultiply', num(value));
        else if (name === 'Good Efficiency Judgement Value') set(s, 'goodEfficiency', num(value));
        continue;
      }

      if (block.startsWith('Feeder')) {
        if (block !== 'Feeder') continue; // the optimum copy is never written
        const [group, name] = parts;
        let m;
        if (group === 'RF' && (m = name.match(/^RF (\d+) (amplitude|time)$/))) {
          const h = Number(m[1]) - 1;
          if (h >= 0 && h < HEADS) set((p.rf[h] ||= {}), m[2] === 'amplitude' ? 'amp' : 'time', num(value));
        } else if (group === 'DF' && (m = name.match(/^DF (\d+) (amplitude|time)$/))) {
          const d = Number(m[1]) - 1;
          if (d >= 0 && d < SECTIONS) set((p.df[d] ||= {}), m[2] === 'amplitude' ? 'amp' : 'time', num(value));
        } else if ((m = group.match(/^DF (\d+) infeed$/))) {
          const d = Number(m[1]) - 1;
          if (d < 0 || d >= SECTIONS) continue;
          const inf = (p.dfInfeed[d] ||= {});
          const afd = (p.afd[d] ||= {});
          const keys = {
            'Infeed weight': [inf, 'infeedWt'], Upper: [inf, 'upperPct'], Lower: [inf, 'lowerPct'],
            'AFD DF upper weight': [inf, 'afdUpperWt'], 'AFD DF lower weight': [inf, 'afdLowerWt'],
            'AFD stop DF lower weight': [inf, 'afdStopLowerWt'],
            'AFD auto amplitude min': [afd, 'autoAmpMin'], 'AFD auto amplitude max': [afd, 'autoAmpMax'],
            'AFD auto time min': [afd, 'autoTimeMin'], 'AFD auto time max': [afd, 'autoTimeMax'],
          };
          if (keys[name]) set(keys[name][0], keys[name][1], num(value));
        }
        continue;
      }

      // The product block: whole-preset settings, and a single section's items.
      if (parts.length === 1) {
        if (label === 'Product Name') set(p, 'name', value);
        else if (label === 'Product Code') set(p, 'code', value);
        else if (label === 'Target Weight') set(p, 'target', num(value));
        else if (label === 'Auto Feed Target') set(sec(0), 'autoFeedTarget', num(value));
        else if (label === 'Disch. Priority Count') set(sec(0), 'priority', num(value));
        else if (label === 'Feed Multiplier') set(sec(0), 'feederMultiply', num(value));
        else if (label === 'Good Efficiency Judgement Value') set(sec(0), 'goodEfficiency', num(value));
      }
    }
  }
  return p;
}

const ascii = (text, max) => {
  const s = String(text || '').replace(/[^\x20-\x7e]/g, '?').slice(0, max);
  return s;
};

/**
 * A copy of `buffer` with preset `no` rewritten from `p`.
 *
 * Fields `p` does not carry keep the slot's bytes. The record's modified
 * timestamp is set to `now`. Throws rather than writing anything it cannot
 * represent exactly (a weight over 6553.5 g, a head outside 1-32).
 */
export function writePreset(buffer, no, p, now = new Date()) {
  const L = layoutFor(buffer.byteLength);
  if (!L) throw new Error('Not a Preset.prm');
  if (!(no >= 1 && no <= L.count)) throw new Error(`Preset number must be 1-${L.count}`);
  const RECORD = L.record;
  const out = buffer.slice(0);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  const base = (no - 1) * RECORD;

  // Writing a decoded preset to a different number: start from ITS record,
  // not the target slot's, so the fields this does not write - upper limit,
  // speed and the rest - travel with it instead of being whatever an empty
  // slot held (an upper limit of 0.0 g, in the reference file).
  if (p.from >= 1 && p.from <= L.count && p.from !== no) {
    const src = (p.from - 1) * RECORD;
    u8.copyWithin(base, src, src + RECORD);
  }

  const putText = (o, text, max) => {
    u8.fill(0, base + o, base + o + max + 1);
    const s = ascii(text, max);
    for (let i = 0; i < s.length; i += 1) u8[base + o + i] = s.charCodeAt(i);
  };
  const u16 = (o, v, what) => {
    const n = Math.round(v);
    if (!(n >= 0 && n <= 0xffff)) throw new Error(`${what} ${v} does not fit`);
    dv.setUint16(base + o, n);
  };
  const b8 = (o, v, what) => {
    const n = Math.round(v);
    if (!(n >= 0 && n <= 0xff)) throw new Error(`${what} ${v} does not fit`);
    u8[base + o] = n;
  };
  const has = (v) => v !== undefined && v !== null;

  dv.setUint32(base, 1);
  dv.setUint32(base + 4, no);
  if (has(p.name)) putText(0x08, p.name, L.nameLen);
  if (has(p.code)) putText(0x21, p.code, 22);
  if (has(p.target)) u16(L.total + 0x0a, p.target * 10, 'Target weight');

  p.sections.forEach((s, k) => {
    if (!s) return;
    if (k >= L.sections) {
      if (Object.keys(s).some((key) => key !== 'timing' && s[key] !== undefined) || Object.keys(s.timing || {}).length) {
        throw new Error(`This file has ${L.sections} sections; S${k + 1} cannot be written`);
      }
      return;
    }
    const so = L.sectionsAt + 16 * k;
    if (has(s.heads)) dv.setUint32(base + so, headMask(s.heads));
    const t = s.timing || {};
    const timing = ['WH-PH', 'PH-RF', 'WH-BH', 'BH-WH'];
    timing.forEach((name, i) => { if (has(t[name])) b8(so + 4 + i, t[name] / 10, `${name} (10 ms steps)`); });
    const bo = L.blocks + 136 * k;
    if (has(s.target)) u16(bo + 0x0a, s.target * 10, `S${k + 1} target weight`);
    if (has(s.autoFeedTarget)) b8(bo + 0x1a, s.autoFeedTarget * 10, 'Auto feed target');
    if (has(s.priority)) b8(bo + 0x24, s.priority, 'Priority count');
    if (has(s.feederMultiply)) b8(bo + 0x25, s.feederMultiply, 'Feed multiplier');
    if (has(s.goodEfficiency)) u16(bo + 0x64, s.goodEfficiency * 10, 'Good efficiency');
    const po = L.names + 48 * k;
    if (has(s.prodName)) putText(po, s.prodName, 24);
    if (has(s.prodCode)) putText(po + 25, s.prodCode, 22);
  });

  const F = L.feeder;
  const AFD = 12 * L.sections;
  p.afd.forEach((a, k) => {
    if (!a || k >= L.sections) return;
    const o = F + 4 + 12 * k;
    if (has(a.autoAmpMax)) b8(o + 8, a.autoAmpMax, 'AFD amp max');
    if (has(a.autoAmpMin)) b8(o + 9, a.autoAmpMin, 'AFD amp min');
    if (has(a.autoTimeMax)) b8(o + 10, a.autoTimeMax, 'AFD time max');
    if (has(a.autoTimeMin)) b8(o + 11, a.autoTimeMin, 'AFD time min');
  });
  p.rf.forEach((h, k) => {
    if (!h) return;
    const o = F + 4 + AFD + 2 * k;
    if (has(h.amp)) b8(o, h.amp, `RF ${k + 1} amplitude`);
    if (has(h.time)) b8(o + 1, h.time, `RF ${k + 1} time`);
  });
  p.df.forEach((d, k) => {
    if (!d) return;
    const o = F + 4 + AFD + 64 + 2 * k;
    if (has(d.amp)) b8(o, d.amp, `DF ${k + 1} amplitude`);
    if (has(d.time)) b8(o + 1, d.time, `DF ${k + 1} time`);
  });
  p.dfInfeed.forEach((d, k) => {
    if (!d) return;
    const o = F + 4 + AFD + 64 + 16 + 32 + 10 * k;
    if (has(d.infeedWt)) u16(o, d.infeedWt, 'Infeed weight');
    if (has(d.upperPct)) b8(o + 2, d.upperPct, 'Infeed upper %');
    if (has(d.lowerPct)) b8(o + 3, d.lowerPct, 'Infeed lower %');
    if (has(d.afdUpperWt)) u16(o + 4, d.afdUpperWt, 'AFD DF upper weight');
    if (has(d.afdLowerWt)) u16(o + 6, d.afdLowerWt, 'AFD DF lower weight');
    if (has(d.afdStopLowerWt)) b8(o + 8, d.afdStopLowerWt, 'AFD stop weight');
  });

  const d = now;
  u8.set([d.getFullYear() % 100, d.getMonth() + 1, d.getDate(), d.getDay(), 0,
    d.getHours(), d.getMinutes(), d.getSeconds()], base + L.stamp);
  return out;
}

/**
 * The settings a written record carries that this writer did NOT set: the
 * unproven fields, read back from the result so they can be shown before
 * anyone restores the file.
 */
export function keptFields(record) {
  const t = record.total;
  return [
    ['Upper Weight Limit?', `${t.upper.toFixed(1)} g`],
    ['Tolerance Negative Error?', `${t.tolNegErr.toFixed(1)} g`],
    ['Extended Upper Limit?', `${t.exUpper.toFixed(1)} g`],
    ['Speed?', `${t.speed} bpm`], ['Dump Count?', String(t.dumpCount)],
    ['Average Control?', t.avControl ? 'On' : 'Off'], ['Section Parameter Number?', String(t.sectSet)],
  ];
}

/** Slots with no name, lowest first - where a new preset can go. */
export function emptySlots(presets, count = 200) {
  const used = new Set(presets.map((p) => p.no));
  const out = [];
  for (let n = 1; n <= count; n += 1) if (!used.has(n)) out.push(n);
  return out;
}

export { LAYOUTS };

export { headsOf };
