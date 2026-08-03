// src/components/PartsManualBinding.jsx
//
// JTI-only: link each line to the machine its parts come from.
//
// The Parts Viewer catalog organises as customer -> folder -> diagram, and a
// FOLDER IS ONE MACHINE. It carries no model or serial number, so those cannot
// be the join. Binding a line explicitly is also the safer failure: an unbound
// line says "no manual linked", whereas matching on model/serial strings would
// fail silently on a typo and offer parts from the wrong machine.
//
// The line's own model and serial are shown next to the picker so whoever sets
// this up can see which machine they are binding — they are for confirmation,
// not the matching key.
import { useEffect, useState } from 'react';
import { Link2, Save } from 'lucide-react';
import { fetchPartsCatalog } from '../config/parts.js';
import { savePartsBindings, saveBoardParts } from '../services/logs.js';
import { useToast } from './Toast.jsx';
import BoardPartsByMachine from './BoardPartsByMachine.jsx';

export default function PartsManualBinding({
  workspaceId,
  customerId,
  lines = [],           // [{ title, model, serialNumber }]
  bindings = {},
  boardTypes = [],      // names, for the per-machine board part numbers
  boardParts,           // { byMachine }
  confirm,
  onClose,
}) {
  const toast = useToast();
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(bindings);
  const [partsDraft, setPartsDraft] = useState(boardParts || { byMachine: {} });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPartsCatalog()
      .then((d) => { if (!cancelled) setCatalog(d.customers || []); })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Parts catalog load failed:', err);
        setError(err?.message || 'Could not read the parts catalog.');
      });
    return () => { cancelled = true; };
  }, []);

  const setBinding = (title, patch) =>
    setDraft((d) => {
      const next = { ...d };
      const cur = { partsCustomer: '', folder: '', ...(next[title] || {}), ...patch };
      // Changing the customer invalidates the folder — folders are per customer.
      if (patch.partsCustomer !== undefined) cur.folder = '';
      if (!cur.partsCustomer || !cur.folder) {
        if (!cur.partsCustomer) delete next[title];
        else next[title] = cur;
      } else {
        next[title] = cur;
      }
      return next;
    });

  const commit = async () => {
    setSaving(true);
    try {
      // Only complete bindings are stored — a half-set one would read as linked
      // while returning nothing.
      const cleaned = Object.fromEntries(
        Object.entries(draft).filter(([, b]) => b?.partsCustomer && b?.folder)
      );
      await savePartsBindings(workspaceId, customerId, cleaned);
      // Board parts are keyed by machine, so unlinking a line here can orphan a
      // mapping. Orphans are kept rather than pruned: relinking the same machine
      // later should find its board numbers still there, and a stale key costs
      // nothing but a few bytes.
      await saveBoardParts(workspaceId, customerId, partsDraft);
      toast.success('Parts manuals linked');
      onClose?.();
    } catch (err) {
      console.error('Save parts bindings failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const foldersFor = (partsCustomer) =>
    (catalog || []).find((c) => c.customer === partsCustomer)?.folders || [];

  return (
    <div className="card mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <strong className="d-flex align-items-center gap-2"><Link2 size={16} /> Parts manuals</strong>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>Cancel</button>
      </div>
      <div className="card-body">
        <small className="text-muted d-block mb-3">
          Each line is linked to one machine in the parts catalog. Part numbers
          offered on a replacement come only from that machine&apos;s manual.
        </small>

        {error && <div className="alert alert-warning py-2">{error}</div>}
        {!catalog && !error && <div className="text-muted">Loading the parts catalog…</div>}

        {catalog && lines.length === 0 && (
          <div className="text-muted">No lines found for this customer yet.</div>
        )}

        {catalog && lines.map((l) => {
          const b = draft[l.title] || {};
          return (
            <div key={l.title} className="border rounded p-2 mb-2">
              <div className="fw-semibold">{l.title}</div>
              <div className="small text-muted mb-2">
                {l.model ? `Model ${l.model}` : 'No model recorded'}
                {l.serialNumber ? ` · Serial ${l.serialNumber}` : ' · no serial recorded'}
              </div>
              <div className="d-flex flex-wrap gap-2">
                <select
                  className="form-select form-select-sm"
                  style={{ width: 'auto', maxWidth: '220px' }}
                  value={b.partsCustomer || ''}
                  onChange={(e) => setBinding(l.title, { partsCustomer: e.target.value })}
                  aria-label={`Parts customer for ${l.title}`}
                >
                  <option value="">Parts customer…</option>
                  {catalog.map((c) => (
                    <option key={c.customer} value={c.customer}>{c.customer}</option>
                  ))}
                </select>
                <select
                  className="form-select form-select-sm"
                  style={{ width: 'auto', maxWidth: '260px' }}
                  value={b.folder || ''}
                  disabled={!b.partsCustomer}
                  onChange={(e) => setBinding(l.title, { folder: e.target.value })}
                  aria-label={`Machine for ${l.title}`}
                >
                  <option value="">Machine (folder)…</option>
                  {foldersFor(b.partsCustomer).map((f) => (
                    <option key={f.folder} value={f.folder}>
                      {f.folder} ({f.diagrams})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}

        {catalog && (
          <BoardPartsByMachine
            bindings={draft}
            boardTypes={boardTypes}
            boardParts={partsDraft}
            onChange={setPartsDraft}
            confirm={confirm}
          />
        )}

        {catalog && (
          <button type="button" className="btn btn-primary btn-sm mt-3" onClick={commit} disabled={saving}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save links'}
          </button>
        )}
      </div>
    </div>
  );
}
