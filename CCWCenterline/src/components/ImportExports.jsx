import React, { useMemo, useState } from 'react';
import { parseExportSet, flattenExports, blockToSection } from '../utils/rcuExport';
import { parsePresets, presetBlocks, blankPresetBlocks, isPresetFile, presetLabel, layoutFor } from '../utils/rcuPreset';
import { presetFromSections, writePreset, emptySlots, keptFields } from '../utils/rcuPresetWrite';
import { parseRecord } from '../utils/rcuPreset';
import { downloadBlob } from '../utils/settingsList';
import { matchField } from '../utils/centerline';

/**
 * Pull settings out of what a CCW backup holds.
 *
 * The RCU's Output button writes a folder of text files - one machine block
 * per file, a couple of hundred settings in all. The presets themselves are
 * not among them: they live in the binary `Preset.prm` one folder up. Both
 * are read here. Everything read is listed, and nothing lands on the document
 * until the engineer places it: one value onto a mapped screen, or a whole
 * block (AD parameter, hopper drive, a preset's feeder table) as one section.
 *
 * For a machine that cannot be read at all there is the blank preset: the
 * same blocks with every setting named and every value empty, to be typed.
 */
export default function ImportExports({ spec, onPlace, onAddBlock, sections }) {
  const [set, setSet] = useState({});
  const [presets, setPresets] = useState([]);
  const [presetNo, setPresetNo] = useState(null);
  const [presetFile, setPresetFile] = useState(null);   // { name, buffer } of the loaded Preset.prm
  const [slot, setSlot] = useState('');
  const [writeNote, setWriteNote] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [blankHeads, setBlankHeads] = useState(14);
  const [blankSections, setBlankSections] = useState(1);

  const openFiles = async (fileList) => {
    setError('');
    const files = [...(fileList || [])];
    if (!files.length) return;
    try {
      const presetFiles = files.filter(isPresetFile);
      const textFiles = files.filter((f) => /\.csv$/i.test(f.name));
      const read = await Promise.all(textFiles.map(async (f) => ({ name: f.name, text: await f.text() })));
      const exports = parseExportSet(read);
      let found = [];
      for (const f of presetFiles) {
        const buffer = await f.arrayBuffer();
        found = found.concat(parsePresets(buffer));
        setPresetFile({ name: f.name, buffer });
      }
      if (!Object.keys(exports).length && !found.length) {
        const prm = files.find((f) => /\.prm$/i.test(f.name) && /^preset/i.test(f.name));
        setError(prm
          ? `${prm.name} is ${prm.size} bytes, which is not a Preset.prm size this reads (578,400 for the 32-head file, 793,600 for the 14-head). If it is from another RCU generation, send it over and the layout can be added.`
          : 'Nothing readable in that selection - the .csv files the Output button writes, or Preset.prm.');
        return;
      }
      if (Object.keys(exports).length) setSet((s) => ({ ...s, ...exports }));
      if (found.length) {
        setPresets(found);
        setPresetNo(found[0].no);
        setSlot(String(emptySlots(found, layoutFor(found[0].layout).count)[0] || ''));
      }
    } catch (err) {
      setError(err?.message || 'Could not read those files.');
    }
  };

  const preset = presets.find((p) => p.no === presetNo);
  // The chosen preset's blocks sit beside the machine blocks, in one list.
  const blocks = useMemo(() => (preset ? { ...set, ...presetBlocks(preset) } : set), [set, preset]);
  const flat = useMemo(() => flattenExports(blocks), [blocks]);
  const loaded = Object.keys(blocks).length > 0;

  // Which mapped field, if any, each imported setting belongs to.
  const targets = (label) => {
    const out = [];
    for (const [slug, screen] of Object.entries(spec.screens)) {
      const field = matchField(label, screen.fields);
      if (field) out.push({ slug, screen, field });
    }
    return out;
  };

  const shown = flat.filter((row) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return row.path.toLowerCase().includes(q) || String(row.value).toLowerCase().includes(q);
  });

  const addBlank = () => {
    const heads = Math.min(Math.max(Number(blankHeads) || 14, 1), 32);
    const sections = Math.min(Math.max(Number(blankSections) || 1, 1), 8);
    onAddBlock(Object.entries(blankPresetBlocks(heads, sections))
      .map(([key, block]) => blockToSection(block, key)));
  };

  /** Forget the loaded files. The document is untouched. */
  const clearFiles = () => {
    setSet({});
    setPresets([]);
    setPresetNo(null);
    setPresetFile(null);
    setWriteNote('');
    setFilter('');
    setError('');
  };

  // The preset blocks on the document are what gets written back.
  const presetSections = (sections || []).filter((s) => s.kind === 'photo' && /^Preset(?: \d+)? · /.test(s.title || ''));
  const slotNo = Number(slot);
  const overwriting = presets.find((p) => p.no === slotNo);

  const writeFile = () => {
    setWriteNote('');
    try {
      const p = presetFromSections(presetSections);
      const out = writePreset(presetFile.buffer, slotNo, p);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(new Blob([out], { type: 'application/octet-stream' }), `Preset_${slotNo}_${stamp}.prm`);
      const L = layoutFor(out.byteLength);
      const record = parseRecord(new DataView(out), (slotNo - 1) * L.record, slotNo - 1, L);
      const kept = keptFields(record).map(([k, v]) => `${k} ${v}`).join(', ');
      const basis = p.from && p.from !== slotNo ? `preset ${p.from}` : `what preset ${slotNo} already held`;
      setWriteNote(`Written: preset ${slotNo}${p.name ? ` "${p.name}"` : ''} into a copy of ${presetFile.name}. `
        + 'Rename it Preset.prm beside the other .prm files before restoring. '
        + `Not written, kept from ${basis}: ${kept}.`);
    } catch (err) {
      setWriteNote(`Not written: ${err.message}`);
    }
  };

  return (
    <section className="card p-4 mb-4">
      <h3 className="font-semibold mb-1">Import from the machine</h3>
      <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>
        Select the .csv files the RCU’s Output button wrote, and Preset.prm from the
        backup’s cw folder for the presets themselves.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label className="btn">
          Choose backup files
          <input
            type="file" accept=".csv,.prm,text/csv,text/plain" multiple className="hidden"
            onChange={(e) => openFiles(e.target.files)}
          />
        </label>
        {onAddBlock && (
          <span className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            <span>or write one by hand:</span>
            <input
              className="field" type="number" min="1" max="32" style={{ width: '4.5rem' }}
              value={blankHeads} onChange={(e) => setBlankHeads(e.target.value)} aria-label="Heads"
            />
            <span>heads</span>
            <input
              className="field" type="number" min="1" max="8" style={{ width: '4.5rem' }}
              value={blankSections} onChange={(e) => setBlankSections(e.target.value)} aria-label="Sections"
            />
            <span>sections</span>
            <button type="button" className="btn" onClick={addBlank}>Add a blank preset</button>
          </span>
        )}
      </div>
      {error && <p className="text-sm mt-2" style={{ color: 'var(--danger)' }}>{error}</p>}

      {presets.length > 0 && (
        <div className="mt-4">
          <p className="field-label">Presets in Preset.prm ({layoutFor(presets[0].layout).label} file)</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.no} type="button" className={p.no === presetNo ? 'btn btn-primary' : 'btn'}
                onClick={() => setPresetNo(p.no)}
                title={p.modified ? `Last changed on the RCU ${p.modified}` : ''}
              >
                {p.no}: {presetLabel(p)}
              </button>
            ))}
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-subtle)' }}>
            Values marked “?” are decoded from the binary with good evidence but are not proven;
            they go on the document flagged “check”.
          </p>
        </div>
      )}

      {presetFile && presetSections.length > 0 && (
        <div className="mt-4 p-3 rounded" style={{ background: 'var(--surface-sunken)' }}>
          <p className="field-label">Write back to the machine</p>
          <p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
            The {presetSections.length} preset block{presetSections.length === 1 ? '' : 's'} on this document,
            as edited, become one preset in a copy of {presetFile.name}. Only settings whose place in the
            file is proven are written; those marked “?” keep the machine’s own values.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Preset number</span>
            <input
              className="field" type="number" min="1" max={layoutFor(presetFile.buffer.byteLength).count} style={{ width: '5.5rem' }}
              value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Preset number"
            />
            {overwriting && (
              <span className="chip" style={{ color: 'var(--warn)' }}>
                replaces {overwriting.no}: {presetLabel(overwriting)}
              </span>
            )}
            <button
              type="button" className="btn btn-primary" onClick={writeFile}
              disabled={!(slotNo >= 1 && slotNo <= layoutFor(presetFile.buffer.byteLength).count)}
            >
              Write Preset.prm
            </button>
          </div>
          {writeNote && (
            <p className="text-sm mt-2" style={{ color: writeNote.startsWith('Not') ? 'var(--danger)' : 'var(--text)' }}>
              {writeNote}
            </p>
          )}
          <p className="text-xs mt-2" style={{ color: 'var(--text-subtle)' }}>
            First time on a machine: write into an empty number, restore it, and read the screens back
            before trusting it on a live preset.
          </p>
        </div>
      )}

      {loaded && onAddBlock && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="field-label">Whole blocks</p>
            <button type="button" className="btn" onClick={clearFiles} title="Forget the loaded files. Nothing already on the document is touched.">
              Clear files
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(blocks).map(([block, parsed]) => {
              const count = flat.filter((row) => row.block === block).length;
              return (
                <button
                  key={block} type="button" className="btn" disabled={!count}
                  title={count ? `Add all ${count} settings as one section` : 'Nothing readable in this file'}
                  onClick={() => onAddBlock(blockToSection(parsed, block))}
                >
                  + {parsed.title || block} ({count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {loaded && (
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
            Nothing is placed on the centerline until you place it.
          </p>
        </div>
      )}
    </section>
  );
}
