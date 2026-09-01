import React, { useState } from 'react';
import { parseExportSet, flattenExports } from '../utils/rcuExport';
import { matchField } from '../utils/centerline';

/**
 * Pull settings out of the files a CCW writes to its output folder.
 *
 * The RCU's Output button writes a folder of text files — one block per file,
 * a couple of hundred settings in all. Most of them are machine-level and are
 * not what a product centerline is about, so this shows everything it read and
 * lets the engineer place what matters, rather than guessing which of 289
 * values belong on the document.
 */
export default function ImportExports({ spec, onPlace }) {
  const [flat, setFlat] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const openFiles = async (fileList) => {
    setError('');
    const files = [...(fileList || [])];
    if (!files.length) return;
    try {
      const read = await Promise.all(files.map(async (f) => ({
        name: f.name, text: await f.text(),
      })));
      const set = parseExportSet(read);
      if (!Object.keys(set).length) {
        setError('No RCU export files in that selection — they are the .csv files the Output button writes.');
        return;
      }
      setFlat(flattenExports(set));
    } catch {
      setError('Could not read those files.');
    }
  };

  // Which mapped field, if any, each imported setting belongs to.
  const targets = (label) => {
    const out = [];
    for (const [slug, screen] of Object.entries(spec.screens)) {
      const field = matchField(label, screen.fields);
      if (field) out.push({ slug, screen, field });
    }
    return out;
  };

  const shown = (flat || []).filter((row) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return row.path.toLowerCase().includes(q) || String(row.value).toLowerCase().includes(q);
  });

  return (
    <section className="card p-4 mb-4">
      <h3 className="font-semibold mb-1">Import from the machine</h3>
      <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
        Select the .csv files the RCU’s Output button wrote to its output folder.
      </p>

      <label className="btn">
        Choose export files
        <input
          type="file" accept=".csv,text/csv,text/plain" multiple className="hidden"
          onChange={(e) => openFiles(e.target.files)}
        />
      </label>
      {error && <p className="text-sm mt-2" style={{ color: 'var(--danger)' }}>{error}</p>}

      {flat && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {flat.length} settings read. {shown.length !== flat.length && `${shown.length} shown.`}
            </p>
            <input
              className="field" style={{ maxWidth: '16rem' }} value={filter}
              placeholder="Filter…" onChange={(e) => setFilter(e.target.value)}
            />
          </div>

          <div
            className="overflow-auto rounded border"
            style={{ borderColor: 'var(--border)', maxHeight: '22rem' }}
          >
            <table className="w-full text-sm">
              <tbody>
                {shown.map((row) => {
                  const places = targets(row.label);
                  return (
                    <tr key={row.path} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-2 py-1" style={{ color: 'var(--text-muted)' }}>
                        {row.path}
                      </td>
                      <td className="px-2 py-1 font-semibold whitespace-nowrap">{row.value}</td>
                      <td className="px-2 py-1 text-right whitespace-nowrap">
                        {places.length ? places.map((p) => (
                          <button
                            key={p.slug} type="button" className="btn ml-1"
                            onClick={() => onPlace(p.slug, p.field.key, String(row.value))}
                          >
                            → {p.screen.title.replace('Preset - ', '')}
                          </button>
                        )) : (
                          <span className="chip">no matching field</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-subtle)' }}>
            Most of these are machine-level parameters rather than product settings.
            Nothing is placed on the centerline until you place it.
          </p>
        </div>
      )}
    </section>
  );
}
