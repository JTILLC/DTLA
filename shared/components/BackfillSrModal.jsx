import { useState, useMemo } from 'react';
import { Hash, Search } from 'lucide-react';
import { useBodyScrollLock } from '../utils/useBodyScrollLock.js';

// Bulk-assign service report numbers to historical visits so they become
// look-up-able by number in the dashboard. Works ACROSS all customers (reads
// the app's already-loaded all-customers visit list). Nothing is written until
// the user presses Save; only rows whose number actually changed are saved.
export default function BackfillSrModal({ visits = [], customers = [], onClose, onSave }) {
  useBodyScrollLock();
  const custName = useMemo(() => {
    const m = new Map(customers.map((c) => [c.id, c.name]));
    return (id) => m.get(id) || 'Unknown customer';
  }, [customers]);

  const [edits, setEdits] = useState({}); // visitId -> number string (only edited rows)
  const [onlyUntagged, setOnlyUntagged] = useState(true);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const numberOf = (v) => (v.id in edits ? edits[v.id] : v.globalData?.serviceReportNumber || '');

  const rows = useMemo(() => {
    let list = visits.filter((v) => !v.deleted);
    // Oldest first — natural order for working through a chronological backlog.
    list = [...list].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    if (onlyUntagged) list = list.filter((v) => !(v.globalData?.serviceReportNumber));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (v) =>
          (v.name || '').toLowerCase().includes(q) ||
          custName(v.customerId).toLowerCase().includes(q)
      );
    }
    return list;
  }, [visits, onlyUntagged, search, custName]);

  const pending = useMemo(() => {
    return Object.entries(edits)
      .map(([visitId, number]) => {
        const v = visits.find((x) => x.id === visitId);
        if (!v) return null;
        const original = v.globalData?.serviceReportNumber || '';
        if ((number || '').trim() === original) return null;
        return { visitId, customerId: v.customerId, number: (number || '').trim() };
      })
      .filter(Boolean);
  }, [edits, visits]);

  const handleSave = async () => {
    if (pending.length === 0) return onClose();
    setSaving(true);
    await onSave(pending);
    setSaving(false);
    onClose();
  };

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title d-flex align-items-center gap-2"><Hash size={18} /> Backfill Service Report #s</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
          </div>
          <div className="modal-body">
            <p className="small text-muted">
              Assign a service report number to past visits so they can be looked up by number in the dashboard.
              Type a number (format <code>YYYY###</code>) next to each visit, then press <strong>Save</strong>.
            </p>
            <div className="d-flex align-items-center gap-3 flex-wrap mb-3">
              <div className="input-group input-group-sm" style={{ maxWidth: 260 }}>
                <span className="input-group-text"><Search size={14} /></span>
                <input className="form-control" placeholder="Search customer or visit" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <label className="d-flex align-items-center gap-1 small mb-0">
                <input type="checkbox" checked={onlyUntagged} onChange={(e) => setOnlyUntagged(e.target.checked)} />
                Only untagged
              </label>
              <span className="text-muted small ms-auto">{rows.length} visit{rows.length === 1 ? '' : 's'}</span>
            </div>

            {rows.length === 0 ? (
              <p className="text-muted mb-0">No visits to show.{onlyUntagged ? ' Every visit already has a number. 🎉' : ''}</p>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Visit</th>
                      <th style={{ width: 130 }}>SR #</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((v) => (
                      <tr key={v.id}>
                        <td className="text-nowrap">
                          {v.date ? new Date(v.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                        </td>
                        <td>{custName(v.customerId)}</td>
                        <td>{v.name || <span className="text-muted">Unnamed</span>}</td>
                        <td>
                          <input
                            type="text"
                            inputMode="numeric"
                            className="form-control form-control-sm"
                            placeholder="YYYY###"
                            value={numberOf(v)}
                            onChange={(e) => setEdits((prev) => ({ ...prev, [v.id]: e.target.value }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <span className="text-muted small me-auto">{pending.length} change{pending.length === 1 ? '' : 's'} pending</span>
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || pending.length === 0}>
              {saving ? 'Saving…' : pending.length ? `Save ${pending.length}` : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
