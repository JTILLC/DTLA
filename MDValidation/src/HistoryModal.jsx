import { useState, useEffect, useMemo } from 'react';
import { listValidations, deleteValidation } from './cloud';

export default function HistoryModal({ collection, uid, summary, onClose, onLoad }) {
  const [items, setItems] = useState(null);
  const [term, setTerm] = useState('');
  const [err, setErr] = useState('');

  const refresh = async () => {
    setErr('');
    try { setItems(await listValidations(collection, uid)); }
    catch { setErr('Could not load saved validations.'); setItems([]); }
  };
  useEffect(() => { refresh(); }, [uid, collection]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t || !items) return items || [];
    return items.filter((v) => {
      const s = summary(v);
      return `${s.title} ${s.sub}`.toLowerCase().includes(t);
    });
  }, [items, term, summary]);

  const fmt = (ms) => { try { return new Date(ms).toLocaleString(); } catch { return ''; } };
  const remove = async (id) => {
    if (!window.confirm('Delete this saved validation?')) return;
    await deleteValidation(collection, id);
    refresh();
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modalcard" onClick={(e) => e.stopPropagation()}>
        <div className="modalhead">
          <h3>Saved Validations</h3>
          <button className="x" onClick={onClose}>×</button>
        </div>
        <input className="search" placeholder="Search…" value={term} onChange={(e) => setTerm(e.target.value)} />
        {err && <div className="err">{err}</div>}
        {items === null ? (
          <div className="muted">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="muted">{items.length === 0 ? 'No saved validations yet.' : 'No matches.'}</div>
        ) : (
          <ul className="histlist">
            {filtered.map((v) => {
              const s = summary(v);
              return (
                <li key={v.cloudId}>
                  <button className="histload" onClick={() => onLoad(v)}>
                    <strong>{s.title}</strong>
                    <span>{s.sub}</span>
                    <span className="muted">Saved {fmt(v.updatedAt)}</span>
                  </button>
                  <button className="del" onClick={() => remove(v.cloudId)} title="Delete">🗑</button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
