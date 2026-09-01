#!/usr/bin/env python3
"""Read the settings files the CCW writes to its output folder.

These are named .csv but are not comma-separated: they are the RCU's own
printout, a block title between rules and then `LABEL : VALUE` lines in fixed
columns.

The one thing that will catch you out is that a value can sit on the line ABOVE
its label:

    RANGE           : 400 g
                   1.0 g
    EMPTY JUDG WT   :

EMPTY JUDG WT is 1.0 g. The RCU draws its screens with the value above the
label and prints them the same way, so a label line with nothing after the
colon takes the bare line before it. Read the file top-to-bottom without that
rule and every wrapped field silently comes out blank.

Files also carry repeating sub-blocks (`--INFEEDER 1--`, `--PARAMETER 3--`,
`== PH ==`), which become nested groups rather than colliding keys.

Usage: python3 tools/parse_export.py <file-or-dir> [--json]
"""
import json, os, re, sys

RULE = re.compile(r'^-{3,}$')
SUBHEAD = re.compile(r'^\s*[-=]{2}\s*(.+?)\s*[-=]{2}\s*$')
LABELLED = re.compile(r'^(?P<label>[^:]+?)\s*:\s*(?P<value>.*)$')


def parse(text):
    """{'title': str, 'values': {...}, 'groups': {name: {...}}} from one export."""
    lines = text.splitlines()
    title, body_start = None, 0
    for i, line in enumerate(lines):
        if RULE.match(line.strip()) and i + 2 < len(lines) and RULE.match(lines[i + 2].strip()):
            title = lines[i + 1].strip()
            body_start = i + 3
            break

    result = {'title': title, 'values': {}, 'groups': {}}
    target = result['values']
    pending = None          # a bare line that may belong to the label below it
    rows = []               # bare numeric rows inside a sub-block (drive patterns)

    for raw in lines[body_start:]:
        line = raw.rstrip()
        if not line.strip() or RULE.match(line.strip()):
            pending = None
            continue

        sub = SUBHEAD.match(line)
        if sub:
            if rows:
                target['_rows'] = rows
                rows = []
            name = sub.group(1).strip()
            target = result['groups'].setdefault(name, {})
            pending = None
            continue

        m = LABELLED.match(line)
        if m:
            label = m.group('label').strip()
            value = m.group('value').strip()
            # Empty after the colon: the value was printed above the label.
            if not value and pending is not None:
                value = pending
            target[label] = value
            pending = None
        else:
            bare = line.strip()
            # A row of numbers is data (a drive pattern), not a wrapped value.
            if re.fullmatch(r'[\d\s.-]+', bare) and len(bare.split()) > 2:
                rows.append(bare.split())
                pending = None
            else:
                pending = bare
    if rows:
        target['_rows'] = rows
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
        print(json.dumps(out, indent=1))
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
