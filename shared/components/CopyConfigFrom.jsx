// src/components/CopyConfigFrom.jsx
//
// "Copy this setup from another customer."
//
// A PM checklist or a board-type list is largely the same from plant to plant —
// same machines, same checks. Setting up a new customer by retyping one that
// already exists a few customers over is wasted effort and a source of drift.
//
// Deliberately loads into the EDITOR rather than saving straight over the
// current customer's setup. A copy is a starting point to adapt, and an
// immediate write would let one mis-tap destroy a checklist that took a while
// to build — with nothing to undo it.
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { fetchConfig } from '../services/logs.js';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';

export default function CopyConfigFrom({
  workspaceId,
  customers = [],
  currentCustomerId,
  configKey,          // 'pmTemplate' | 'boardTypes'
  label,              // e.g. 'checklist'
  describe,           // (data) => string | null   null = nothing worth copying
  onCopy,             // (data) => void — load into the caller's draft
}) {
  const toast = useToast();
  const dialog = useDialog();
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);

  const others = customers.filter((c) => c?.id && c.id !== currentCustomerId);
  if (others.length === 0) return null;

  const run = async () => {
    if (!from) return toast.error('Pick a customer to copy from');
    setBusy(true);
    try {
      const data = await fetchConfig(workspaceId, from, configKey);
      const summary = data ? describe(data) : null;
      if (!summary) {
        const name = others.find((c) => c.id === from)?.name || 'That customer';
        return toast.error(`${name} has no ${label} set up yet.`);
      }
      const ok = await dialog.confirm(
        `Load ${summary} from ${others.find((c) => c.id === from)?.name}? ` +
        `This replaces what's in the editor — nothing is saved until you press save.`,
        { title: `Copy ${label}`, confirmText: 'Load into editor' }
      );
      if (!ok) return;
      onCopy(data);
      toast.success(`Loaded — review it, then save.`);
    } catch (err) {
      console.error('Copy config failed:', err);
      toast.error('Could not read that customer: ' + (err?.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
      <label className="small text-muted mb-0" htmlFor={`copy-from-${configKey}`}>
        Copy {label} from
      </label>
      <select
        id={`copy-from-${configKey}`}
        className="form-select form-select-sm"
        style={{ width: 'auto', maxWidth: '220px' }}
        value={from}
        onChange={(e) => setFrom(e.target.value)}
      >
        <option value="">Choose a customer…</option>
        {others.map((c) => (
          <option key={c.id} value={c.id}>{c.name || c.id}</option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={run}
        disabled={busy || !from}
      >
        <Copy size={14} /> {busy ? 'Loading…' : 'Load'}
      </button>
      {dialog.DialogComponent}
    </div>
  );
}
