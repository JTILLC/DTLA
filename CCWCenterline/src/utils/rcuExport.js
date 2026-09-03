// Reading the settings files a CCW writes to its output folder.
//
// They are named .csv and are not comma-separated. Each is the RCU's own
// printout: a block title between rules, then `LABEL : VALUE` in fixed columns.
//
// The rules below were checked against a real output folder from a 32-head
// machine on an RCU W0530G (nine files, July 2024). The things that silently
// corrupt a naive read, and put wrong numbers on a document that goes to a
// customer:
//
// 1. A value that does not fit after its label wraps onto the NEXT line.
//
//        RANGE           : 400 g
//        EMPTY JUDG WT   :
//                       1.0 g
//        AUTO ZERO TOL   : 4.00 g
//
//    EMPTY JUDG WT is 1.0 g. Read in strict reading order, EMPTY JUDG WT comes
//    out blank; read with the wrapped line attached to the label AFTER it,
//    every wrapped field lands on the wrong setting - ACTUATOR TYPE becomes
//    SLIT, DRIVE POWER becomes STEPPING MOTOR, and each value is individually
//    plausible. (An earlier version of this file said the value printed above
//    its label. The real exports say otherwise; the bare line above is now only
//    a fallback when nothing follows.)
//
// 2. Sub-blocks reuse key names, at two levels. `== PH ==` and `== WH ==` both
//    carry STOP DELAY PLS and each has its own `--- DRIVE PATTERN ---`;
//    `-- INTLK PARM NO. 1 --` through 4 each carry a `===== DTH1 =====`.
//    Flattened, one silently overwrites the other. The first sub-block style a
//    file uses is its top level; the other style nests beneath it.
//
// 3. A block title can repeat mid-file (INTERLOCK PARAMETER prints its rules
//    and title again before every parameter set). It is not a value.
//
// 4. Feed Frequency has two value columns under a bare header (NTRL, DRV).
//    One value per setting, or the DRV column is lost.
//
// This is a port of tools/parse_export.py, which is the same logic with the
// same tests - the Python one is for working at the command line against a
// backup folder, this one runs in the browser when files are dropped in.

const RULE = /^-{3,}$/;
const SUBHEAD = /^\s*([-=]{2,})\s*(.+?)\s*[-=]{2,}\s*$/;
const LABELED = /^([^:]+?)\s*:\s*(.*)$/;
const NUMERIC_ROW = /^[\d\s.-]+$/;
const BOARD_HEADER = /^\s*NAME\s+NODE\s*ID\s*$/i;
const REVISION = /^\d+(\.\d+)*$/;

const squash = (s) => String(s).trim().replace(/\s+/g, ' ');

const isNumericRow = (bare) => NUMERIC_ROW.test(bare) && bare.split(/\s+/).length > 2;

/** A line that is neither blank, rule, sub-heading, label nor data row. */
const isBare = (line) => {
  const t = line.trim();
  return !!t && !RULE.test(t) && !SUBHEAD.test(line) && !LABELED.test(line) && !isNumericRow(t);
};

/**
 * The board table in PROGRAM INFORMATION: `NAME NODE ID / REVISION`, then one
 * board per pair of lines (`  RCU  0- 0 W0530G` / `8.1`). This is what says
 * which RCU generation a machine is, so it is worth keeping.
 */
function parseBoards(lines, from, into) {
  let i = from;
  let open = null;
  for (; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (!t) { if (open) break; continue; }
    if (/^REVISION$/i.test(t)) continue;
    if (RULE.test(t) || SUBHEAD.test(lines[i])) break;
    if (REVISION.test(t) && open) {
      into[open.name] = `${open.model} rev ${t} (node ${open.node})`;
      open = null;
      continue;
    }
    const parts = t.split(/\s+/);
    if (parts.length < 3) { open = null; continue; }
    open = {
      name: parts[0],
      model: parts[parts.length - 1],
      node: parts.slice(1, -1).join('').replace(/\s+/g, ''),
    };
  }
  if (open) into[open.name] = `${open.model} (node ${open.node})`;
  return i;
}

/**
 * One export file -> { title, values, groups }.
 *
 * `values` holds the top-level settings; `groups` holds each sub-block by its
 * path (`PH`, `PH › DRIVE PATTERN`, `INTLK PARM NO. 1 › DTH1`), with a `_rows`
 * array for blocks that are a table of numbers (drive patterns).
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
  let topStyle = null;   // '-' or '=': the first sub-heading style is the top level
  let parent = null;     // the current top-level sub-block
  let pending = null;    // a bare line above a label: the fallback only
  let columns = null;    // a bare header naming the value columns (NTRL DRV)
  let rows = [];         // bare numeric rows inside a sub-block

  const flushRows = () => {
    if (rows.length) {
      target._rows = rows;
      rows = [];
    }
  };

  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i].replace(/\s+$/, '');
    const t = line.trim();

    // The title printing again, rules and all: skip it whole.
    if (RULE.test(t) && title && i + 2 < lines.length
        && lines[i + 1].trim() === title && RULE.test(lines[i + 2].trim())) {
      i += 2;
      pending = null;
      columns = null;
      continue;
    }
    if (!t || RULE.test(t)) {
      pending = null;
      columns = null;
      continue;
    }

    const sub = line.match(SUBHEAD);
    if (sub) {
      flushRows();
      const style = sub[1][0];
      const name = squash(sub[2]);
      if (!topStyle) topStyle = style;
      let path;
      if (style === topStyle || !parent) {
        parent = name;
        path = name;
      } else {
        path = `${parent} › ${name}`;
      }
      if (!result.groups[path]) result.groups[path] = {};
      target = result.groups[path];
      pending = null;
      columns = null;
      continue;
    }

    if (BOARD_HEADER.test(line)) {
      flushRows();
      const boards = result.groups.BOARDS || (result.groups.BOARDS = {});
      i = parseBoards(lines, i + 1, boards) - 1;
      pending = null;
      columns = null;
      continue;
    }

    const m = line.match(LABELED);
    if (m) {
      const label = squash(m[1]);
      let value = squash(m[2]);
      if (!value) {
        // Nothing after the colon: the value wrapped onto the next line.
        if (i + 1 < lines.length && isBare(lines[i + 1])) {
          value = squash(lines[i + 1]);
          i += 1;
        } else if (pending !== null) {
          value = pending;
        }
        target[label] = value;
      } else {
        const parts = value.split(' ');
        if (columns && parts.length === columns.length) {
          columns.forEach((col, k) => { target[`${label} ${col}`] = parts[k]; });
        } else {
          target[label] = value;
        }
      }
      pending = null;
      continue;
    }

    const bare = t;
    if (isNumericRow(bare)) {
      rows.push(bare.split(/\s+/));
      pending = null;
    } else {
      pending = squash(bare);
      const parts = pending.split(' ');
      columns = parts.length >= 2 ? parts : null;
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

/** The label/value pairs of one parsed block, sub-block paths included. */
function blockEntries(parsed) {
  const out = [];
  const push = (group, label, value) => out.push({ group, label, value });
  const walk = (group, entries) => {
    for (const [label, value] of Object.entries(entries)) {
      if (label !== '_rows') push(group, label, value);
    }
    // A table of numbers is one row per setting: the row number is its label.
    for (const row of entries._rows || []) push(group, row[0], row.slice(1).join(' '));
  };
  walk(null, parsed.values);
  for (const [group, entries] of Object.entries(parsed.groups)) walk(group, entries);
  return out;
}

/**
 * Every setting in a parsed set, flattened for matching and display.
 *
 * Sub-block keys keep their block in the path (`Hopper › PH › STOP DELAY PLS`)
 * precisely because those names repeat - the path is what makes two identical
 * labels tell themselves apart.
 */
export function flattenExports(parsedSet) {
  const out = [];
  for (const [block, parsed] of Object.entries(parsedSet)) {
    for (const { group, label, value } of blockEntries(parsed)) {
      out.push({
        block, group, label, value,
        path: [block, group, label].filter(Boolean).join(' › '),
      });
    }
  }
  return out;
}

/**
 * One whole export block as a section of the document: its title, and every
 * setting as a label/value pair with the sub-block in the label, so `STOP
 * DELAY PLS` from PH and from WH stay two different settings on the page.
 */
export function blockToSection(parsed, block) {
  // A block can name readings it is not sure of (a decoded preset does);
  // those show as "check" on the document, like an uncertain photo read.
  const unsure = new Set(parsed.unsure || []);
  return {
    kind: 'photo',
    title: parsed.title || block,
    image: '',
    source: 'imported',
    fields: blockEntries(parsed).map(({ group, label, value }) => ({
      label: group ? `${group} › ${label}` : label,
      value: String(value ?? ''),
      confident: !unsure.has(label),
    })),
  };
}
