#!/usr/bin/env python3
"""Read the settings files the CCW writes to its output folder.

These are named .csv but are not comma-separated: they are the RCU's own
printout, a block title between rules and then `LABEL : VALUE` lines in fixed
columns.

Checked against a real output folder from a 32-head machine on an RCU W0530G.
The things that will catch you out:

1. A value that does not fit after its label wraps onto the NEXT line:

       RANGE           : 400 g
       EMPTY JUDG WT   :
                      1.0 g

   EMPTY JUDG WT is 1.0 g. Attach wrapped lines to the label AFTER them and
   every wrapped field lands on the wrong setting (ACTUATOR TYPE reads SLIT,
   DRIVE POWER reads STEPPING MOTOR), each individually plausible. A bare line
   above an empty label is only a fallback when nothing follows.

2. Sub-blocks reuse key names at two levels: `== PH ==` and `== WH ==` each
   have their own `--- DRIVE PATTERN ---`; `-- INTLK PARM NO. 1 --` through 4
   each have a `===== DTH1 =====`. The first sub-heading style in a file is
   its top level and the other style nests beneath it.

3. A block title can print again mid-file. It is not a value.

4. Feed Frequency has two value columns under a bare header (NTRL, DRV).

src/utils/rcuExport.js is the same logic with the same tests.

Usage: python3 tools/parse_export.py <file-or-dir> [--json]
"""
import json, os, re, sys

RULE = re.compile(r'^-{3,}$')
SUBHEAD = re.compile(r'^\s*([-=]{2,})\s*(.+?)\s*[-=]{2,}\s*$')
LABELLED = re.compile(r'^(?P<label>[^:]+?)\s*:\s*(?P<value>.*)$')
NUMERIC_ROW = re.compile(r'[\d\s.-]+')
BOARD_HEADER = re.compile(r'^\s*NAME\s+NODE\s*ID\s*$', re.I)
REVISION = re.compile(r'^\d+(\.\d+)*$')


def squash(s):
    return ' '.join(str(s).split())


def is_numeric_row(bare):
    return bool(NUMERIC_ROW.fullmatch(bare)) and len(bare.split()) > 2


def is_bare(line):
    """Neither blank, rule, sub-heading, label nor data row."""
    t = line.strip()
    return bool(t) and not RULE.match(t) and not SUBHEAD.match(line) \
        and not LABELLED.match(line) and not is_numeric_row(t)


def parse_boards(lines, start, into):
    """The NAME / NODE ID / REVISION table: one board per pair of lines."""
    i = start
    current = None
    while i < len(lines):
        t = lines[i].strip()
        if not t:
            if current:
                break
            i += 1
            continue
        if t.upper() == 'REVISION':
            i += 1
            continue
        if RULE.match(t) or SUBHEAD.match(lines[i]):
            break
        if REVISION.match(t) and current:
            into[current['name']] = '%s rev %s (node %s)' % (current['model'], t, current['node'])
            current = None
            i += 1
            continue
        parts = t.split()
        if len(parts) < 3:
            current = None
        else:
            current = {'name': parts[0], 'model': parts[-1], 'node': ''.join(parts[1:-1])}
        i += 1
    if current:
        into[current['name']] = '%s (node %s)' % (current['model'], current['node'])
    return i


def parse(text):
    """{'title': str, 'values': {...}, 'groups': {path: {...}}} from one export."""
    lines = text.splitlines()
    title, body_start = None, 0
    for i, line in enumerate(lines):
        if RULE.match(line.strip()) and i + 2 < len(lines) and RULE.match(lines[i + 2].strip()):
            title = lines[i + 1].strip()
            body_start = i + 3
            break

    result = {'title': title, 'values': {}, 'groups': {}}
    target = result['values']
    top_style = None        # the first sub-heading style is the top level
    parent = None           # the current top-level sub-block
    pending = None          # a bare line above a label: the fallback only
    columns = None          # a bare header naming the value columns
    rows = []               # bare numeric rows inside a sub-block (drive patterns)

    def flush_rows():
        nonlocal rows
        if rows:
            target['_rows'] = rows
            rows = []

    i = body_start
    while i < len(lines):
        line = lines[i].rstrip()
        t = line.strip()

        if RULE.match(t) and title and i + 2 < len(lines) \
                and lines[i + 1].strip() == title and RULE.match(lines[i + 2].strip()):
            i += 3
            pending = columns = None
            continue
        if not t or RULE.match(t):
            pending = columns = None
            i += 1
            continue

        sub = SUBHEAD.match(line)
        if sub:
            flush_rows()
            style = sub.group(1)[0]
            name = squash(sub.group(2))
            if top_style is None:
                top_style = style
            if style == top_style or parent is None:
                parent = name
                path = name
            else:
                path = '%s › %s' % (parent, name)
            target = result['groups'].setdefault(path, {})
            pending = columns = None
            i += 1
            continue

        if BOARD_HEADER.match(line):
            flush_rows()
            boards = result['groups'].setdefault('BOARDS', {})
            i = parse_boards(lines, i + 1, boards)
            pending = columns = None
            continue

        m = LABELLED.match(line)
        if m:
            label = squash(m.group('label'))
            value = squash(m.group('value'))
            if not value:
                # Nothing after the colon: the value wrapped onto the next line.
                if i + 1 < len(lines) and is_bare(lines[i + 1]):
                    value = squash(lines[i + 1])
                    i += 1
                elif pending is not None:
                    value = pending
                target[label] = value
            else:
                parts = value.split(' ')
                if columns and len(parts) == len(columns):
                    for col, part in zip(columns, parts):
                        target['%s %s' % (label, col)] = part
                else:
                    target[label] = value
            pending = None
            i += 1
            continue

        if is_numeric_row(t):
            rows.append(t.split())
            pending = None
        else:
            pending = squash(t)
            parts = pending.split(' ')
            columns = parts if len(parts) >= 2 else None
        i += 1
    flush_rows()
    return result


def parse_file(path):
    with open(path, encoding='latin-1') as fh:
        return parse(fh.read())


def main(target, as_json=False):
    paths = ([os.path.join(target, f) for f in sorted(os.listdir(target))]
             if os.path.isdir(target) else [target])
    out = {}
    for path in paths:
        if not path.lower().endswith('.csv'):
            continue
        # The RCU pads the block name to 7 characters and appends a
        # YYMMDDhhmmss stamp: Afv____240730142241.csv, Section240730142308.csv.
        # Splitting on '_' works for the first and silently fails for the
        # second, which has no underscore to split on.
        stem = os.path.basename(path)[:7].rstrip('_')
        out[stem] = parse_file(path)
    if as_json:
        print(json.dumps(out, indent=1, ensure_ascii=False))
        return
    for stem, block in out.items():
        print('=== %s — %s' % (stem, block['title']))
        for k, v in block['values'].items():
            if k != '_rows':
                print('    %-24s %s' % (k, v))
        for name, group in block['groups'].items():
            print('    [%s]' % name)
            for k, v in group.items():
                if k != '_rows':
                    print('        %-20s %s' % (k, v))
            if '_rows' in group:
                print('        %d data rows' % len(group['_rows']))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    main(sys.argv[1], '--json' in sys.argv)
