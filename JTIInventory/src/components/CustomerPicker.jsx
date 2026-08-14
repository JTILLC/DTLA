import { useState } from 'react';
import { Plus, X } from 'lucide-react';

/**
 * Multi-select customer picker used on Part/Board forms.
 *
 * Props:
 * - selected: string[]   — customer names currently tagged on the item
 * - onChange: (string[]) => void
 * - customers: { id, name }[]   — existing customers from Firestore
 * - onCreate: (name) => Promise<void> | void
 */
export default function CustomerPicker({ selected = [], onChange, customers = [], onCreate }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const selectedSet = new Set(selected);

  const toggle = (name) => {
    if (selectedSet.has(name)) {
      onChange(selected.filter(n => n !== name));
    } else {
      onChange([...selected, name]);
    }
  };

  const addNew = async (e) => {
    e?.preventDefault?.();
    const name = draft.trim();
    if (!name) return;
    const exists = customers.some(c => c.name.toLowerCase() === name.toLowerCase());
    if (!exists && onCreate) {
      await onCreate(name);
    }
    if (!selectedSet.has(name)) onChange([...selected, name]);
    setDraft('');
    setAdding(false);
  };

  const sorted = [...customers].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {sorted.length === 0 && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            No customers yet. Add one below.
          </span>
        )}
        {sorted.map(c => {
          const on = selectedSet.has(c.name);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.name)}
              className={`pill ${on ? 'pill-primary' : 'pill-muted'}`}
              style={{ cursor: 'pointer', border: on ? '1px solid var(--brand)' : '1px solid var(--border-color)' }}
              aria-pressed={on}
            >
              {on && <span aria-hidden="true">✓</span>}
              {c.name}
            </button>
          );
        })}
      </div>

      {adding ? (
        <form onSubmit={addNew} style={{ display: 'flex', gap: 6 }}>
          <input
            className="form-control form-control-sm"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="New customer name"
            autoFocus
            onBlur={() => { if (!draft.trim()) setAdding(false); }}
            onKeyDown={e => {
              if (e.key === 'Escape') { setAdding(false); setDraft(''); }
            }}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={!draft.trim()}>
            Add
          </button>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setAdding(false); setDraft(''); }}>
            <X size={14} />
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="btn btn-outline-primary btn-sm"
        >
          <Plus size={14} /> New customer
        </button>
      )}
    </div>
  );
}
