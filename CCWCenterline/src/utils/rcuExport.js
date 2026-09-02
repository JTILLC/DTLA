// Reading the settings files a CCW writes to its output folder.
//
// They are named .csv and are not comma-separated. Each is the RCU's own
// printout: a block title between rules, then `LABEL : VALUE` in fixed columns.
//
// Two things silently corrupt a naive read, and both put wrong numbers on a
// document that goes to a customer:
//
// 1. A value can print on the line ABOVE its label.
//
//        RANGE           : 400 g
//                       1.0 g
//        EMPTY JUDG WT   :
//
//    EMPTY JUDG WT is 1.0 g. The RCU draws its screens value-above-label and
//    prints them the same way, so a label line with nothing after the colon
//    takes the bare line before it. Without that rule every wrapped field
//    (EMPTY JUDG WT, COMB CALC, ACTUATOR TYPE, DRIVE POWER) reads as blank.
//
// 2. Sub-blocks reuse key names. `== PH ==` and `== WH ==` both carry
//    STOP DELAY PLS, at 5 and 4. Flattened into one object, one overwrites the
//    other and the centerline prints a figure from the wrong hopper.
//
// This is a port of tools/parse_export.py, which is the same logic with the
// same tests — the Python one is for working at the command line against a
// backup folder, this one runs in the browser when files are dropped in.

const RULE = /^-{3,}$/;
const SUBHEAD = /^\s*[-=]{2}\s*(.+?)\s*[-=]{2}\s*$/;
const LABELED = /^([^:]+?)\s*:\s*(.*)$/;

/**
 * One export file -> { title, values, groups }.
 *
 * `values` holds the top-level settings; `groups` holds each sub-block by name,
 * with a `_rows` array for blocks that are a table of numbers (drive patterns).
 */
export function parseExport(text) {
  const lines = String(text).split(/\r?\n/);

  let title = null;
  let start = 0;
  for (let i = 0; i < lines.length - 2; i += 1) {
    if (RULE.test(lines[i].trim()) && RULE.test(lines[i + 2].trim())) {
      title = lines[i + 1].trim();
      start = i + 3;
      break;
    }
  }

  const result = { title, values: {}, groups: {} };
  let target = result.values;
  let pending = null;   // a bare line that may belong to the label below it
  let rows = [];        // bare numeric rows inside a sub-block

  const flushRows = () => {
    if (rows.length) {
      target._rows = rows;
      rows = [];
    }
  };

  for (const raw of lines.slice(start)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || RULE.test(line.trim())) {
      pending = null;
      continue;
    }

    const sub = line.match(SUBHEAD);
    if (sub) {
      flushRows();
      const name = sub[1].trim();
      if (!result.groups[name]) result.groups[name] = {};
      target = result.groups[name];
      pending = null;
      continue;
    }

    const m = line.match(LABELED);
    if (m) {
      const label = m[1].trim();
      let value = m[2].trim();
      // Nothing after the colon: the value was printed above the label.
      if (!value && pending !== null) value = pending;
      target[label] = value;
      pending = null;
    } else {
      const bare = line.trim();
      // A row of numbers is data (a drive pattern), not a wrapped value.
      if (/^[\d\s.-]+$/.test(bare) && bare.split(/\s+/).length > 2) {
        rows.push(bare.split(/\s+/));
        pending = null;
      } else {
        pending = bare;
      }
    }
  }
  flushRows();
  return result;
}

/**
 * The block name from an export's filename.
 *
 * The RCU pads the name to seven characters then appends YYMMDDhhmmss:
 * `Afv____240730142241.csv`, `Section240730142308.csv`. Splitting on '_' works
 * for the first and fails silently on the second, which has no underscore.
 */
export function exportName(filename) {
  const base = String(filename).replace(/^.*[\\/]/, '');
  return base.slice(0, 7).replace(/_+$/, '');
}

/** Parse a whole dropped folder: [{name, text}] -> { [name]: parsed }. */
export function parseExportSet(files) {
  const out = {};
  for (const { name, text } of files) {
    if (!/\.csv$/i.test(name)) continue;
    out[exportName(name)] = parseExport(text);
  }
  return out;
}

/**
 * Every setting in a parsed set, flattened for matching and display.
 *
 * Sub-block keys keep their block in the path (`Hopper › PH › STOP DELAY PLS`)
 * precisely because those names repeat — the path is what makes two identical
 * labels tell themselves apart.
 */
export function flattenExports(parsedSet) {
  const out = [];
  for (const [block, parsed] of Object.entries(parsedSet)) {
    for (const [label, value] of Object.entries(parsed.values)) {
      if (label === '_rows') continue;
      out.push({ block, group: null, label, value, path: `${block} › ${label}` });
    }
    for (const [group, entries] of Object.entries(parsed.groups)) {
      for (const [label, value] of Object.entries(entries)) {
        if (label === '_rows') continue;
        out.push({ block, group, label, value, path: `${block} › ${group} › ${label}` });
      }
    }
  }
  return out;
}
