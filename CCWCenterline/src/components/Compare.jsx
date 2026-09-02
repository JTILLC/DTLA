import React, { useMemo, useState } from 'react';
import spec from '../data/rcuFields.json';
import { settingsTable } from '../utils/centerline';
import {
  compareSettings, comparisonCsv, comparisonFileName, centerlineLabel,
} from '../utils/compare';
import { downloadText } from '../utils/settingsList';

/**
 * What moved between two centerlines.
 *
 * The question this answers is "is the machine still where we left it", so the
 * answer leads with the count and the changed rows. Everything that held is
 * behind a toggle: on a document with two hundred settings, three that drifted
 * must not have to be hunted for.
 */
export default function Compare({ library, current, onClose }) {
  // The centerline being worked on is offered alongside the saved ones: having
  // just walked the machine, comparing what you have in front of you against
  // last month's is the common case.
  const options = useMemo(() => {
    const list = [...library];
    if (current && !list.some((c) => c.id === current.id)) {
      list.unshift({ ...current, __working: true });
    }
    return list;
  }, [library, current]);

  // Default to the two most recent centerlines that actually HAVE settings.
  // Picking the newest two regardless lands on the blank sheet you are sitting
  // on, and every setting reads as "only in A" — a first view that says nothing
  // and looks alarming.
  const withSettings = useMemo(
    () => options.filter((c) => settingsTable(c, spec).length > 0),
    [options],
  );
  const [aId, setAId] = useState(withSettings[1]?.id || '');
  const [bId, setBId] = useState(withSettings[0]?.id || '');
  const [showSame, setShowSame] = useState(false);

  const left = options.find((c) => c.id === aId) || null;
  const right = options.find((c) => c.id === bId) || null;

  const result = useMemo(() => {
    if (!left || !right) return null;
    return compareSettings(settingsTable(left, spec), settingsTable(right, spec));
  }, [left, right]);

  const picker = (label, value, onChange, hint) => (
    <div>
      <label className="field-label" htmlFor={`cmp-${label}`}>{label} — {hint}</label>
      <select
        id={`cmp-${label}`} className="field" value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose a centerline…</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {centerlineLabel(c)}{c.__working ? ' (on screen now)' : ''}
          </option>
        ))}
      </select>
    </div>
  );

  const rowClass = 'grid gap-2 py-1.5 text-sm items-baseline';
  const rowStyle = { gridTemplateColumns: '1fr 7rem 7rem', borderTop: '1px solid var(--border)' };

  return (
    <section className="card p-4 mb-4">
      <header className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold">Compare centerlines</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            What moved between two records of the same machine.
          </p>
        </div>
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </header>

      {options.length < 2 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          You need two centerlines to compare. Save this one, then save another
          after the next visit.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 mb-4">
            {picker('A', aId, setAId, 'the earlier one')}
            {picker('B', bId, setBId, 'the later one')}
          </div>

          {left && right && left.id === right.id && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              That is the same centerline on both sides. Pick two different ones.
            </p>
          )}

          {result && left.id !== right.id && (
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                <p
                  className="text-base font-semibold"
                  style={{ color: result.identical ? 'var(--ok)' : 'var(--warn)' }}
                >
                  {result.identical
                    ? 'No differences — the machine is where it was.'
                    : `${result.differences} difference${result.differences === 1 ? '' : 's'}`}
                </p>
                <span className="chip">{result.same.length} unchanged</span>
                <button
                  type="button" className="btn"
                  onClick={() => downloadText(
                    comparisonCsv(left, right, result),
                    comparisonFileName(left, right),
                  )}
                >
                  Export comparison (CSV)
                </button>
              </div>

              {!!result.changed.length && (
                <Group title="Changed" rows={result.changed} rowClass={rowClass} rowStyle={rowStyle} highlight />
              )}
              {!!result.onlyA.length && (
                <Group
                  title="Only in A — not recorded in B"
                  rows={result.onlyA} rowClass={rowClass} rowStyle={rowStyle}
                />
              )}
              {!!result.onlyB.length && (
                <Group
                  title="Only in B — new since A"
                  rows={result.onlyB} rowClass={rowClass} rowStyle={rowStyle}
                />
              )}

              {!!result.same.length && (
                <div className="mt-3">
                  <button
                    type="button" className="btn"
                    onClick={() => setShowSame((v) => !v)}
                  >
                    {showSame ? 'Hide' : 'Show'} {result.same.length} unchanged
                  </button>
                  {showSame && (
                    <Group title="" rows={result.same} rowClass={rowClass} rowStyle={rowStyle} muted />
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Group({ title, rows, rowClass, rowStyle, highlight, muted }) {
  let current = null;
  return (
    <div className="mt-3">
      {title && (
        <p className="field-label" style={highlight ? { color: 'var(--warn)' } : undefined}>
          {title}
        </p>
      )}
      <div className={rowClass} style={{ ...rowStyle, borderTop: 'none' }}>
        <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>Setting</span>
        <span className="text-xs text-right" style={{ color: 'var(--text-subtle)' }}>A</span>
        <span className="text-xs text-right" style={{ color: 'var(--text-subtle)' }}>B</span>
      </div>
      {rows.map((row, i) => {
        const head = row.section !== current ? (current = row.section) : null;
        return (
          <React.Fragment key={`${row.section}-${row.label}-${i}`}>
            {head && (
              <p
                className="text-xs mt-2"
                style={{ color: 'var(--text-subtle)', textTransform: 'uppercase' }}
              >
                {head}
              </p>
            )}
            <div className={rowClass} style={rowStyle}>
              <span style={{ color: muted ? 'var(--text-muted)' : 'var(--text)' }}>{row.label}</span>
              <span
                className="text-right font-semibold"
                style={{ color: row.a === null ? 'var(--text-subtle)' : 'var(--text-muted)' }}
              >
                {row.a === null ? '—' : row.a}
              </span>
              <span
                className="text-right font-semibold"
                style={{ color: row.b === null ? 'var(--text-subtle)'
                  : (highlight ? 'var(--warn)' : 'var(--text)') }}
              >
                {row.b === null ? '—' : row.b}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
