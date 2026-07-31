// src/components/ActivityPage.jsx
//
// One line, everything that happened to it, newest first.
//
// Loads the four customer-level logs once and hands them to the feed, rather
// than each event type fetching its own — a line's history is read as a whole
// or not at all.
import { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import {
  subscribeLog, LOG_SPAN, LOG_BOARD, LOG_PM, LOG_CREW,
} from '../services/logs.js';
import LineActivity from './LineActivity.jsx';

const LAST_LINE_KEY = 'ccw-activity-last-line';

export default function ActivityPage({ workspaceId, customerId, customerName, visits = [] }) {
  const [spanLog, setSpanLog] = useState([]);
  const [boardLog, setBoardLog] = useState([]);
  const [pmLog, setPmLog] = useState([]);
  const [crewLog, setCrewLog] = useState([]);
  const [selected, setSelected] = useState('');

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    const unsubs = [
      subscribeLog(workspaceId, customerId, LOG_SPAN, setSpanLog),
      subscribeLog(workspaceId, customerId, LOG_BOARD, setBoardLog),
      subscribeLog(workspaceId, customerId, LOG_PM, setPmLog),
      subscribeLog(workspaceId, customerId, LOG_CREW, setCrewLog, 100),
    ];
    return () => unsubs.forEach((u) => u && u());
  }, [workspaceId, customerId]);

  const lines = useMemo(() => {
    const seen = new Set();
    [...visits]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .forEach((v) => (v.lines || []).forEach((l) => { if (l?.title) seen.add(l.title); }));
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [visits]);

  // Same convenience as the other line-scoped screens: come back to where you were.
  useEffect(() => {
    if (selected || lines.length === 0) return;
    let saved = '';
    try { saved = localStorage.getItem(LAST_LINE_KEY) || ''; } catch { /* ignore */ }
    setSelected(lines.includes(saved) ? saved : lines[0]);
  }, [lines, selected]);

  useEffect(() => {
    if (!selected) return;
    try { localStorage.setItem(LAST_LINE_KEY, selected); } catch { /* ignore */ }
  }, [selected]);

  if (!customerId) {
    return <div className="text-muted p-3">Select a customer to see line activity.</div>;
  }

  return (
    <div>
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <h5 className="d-flex align-items-center gap-2 mb-0">
          <Activity size={18} /> Line activity{customerName ? ` — ${customerName}` : ''}
        </h5>
        <select
          className="form-select form-select-sm"
          style={{ width: 'auto', minWidth: '180px' }}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Line"
        >
          {lines.length === 0 && <option value="">No lines yet</option>}
          {lines.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>

      <LineActivity
        lineTitle={selected}
        spanLog={spanLog}
        boardLog={boardLog}
        pmLog={pmLog}
        crewLog={crewLog}
        visits={visits}
      />
    </div>
  );
}
