// src/components/JobBoard.jsx
//
// Every open job and what it is waiting on — the screen to open first thing.
//
// The packet page already answered this for one job at a time. The answer you
// actually need in the morning is across all of them, and assembling it by hand
// meant opening jobs one by one and holding the result in your head.
//
// Nothing here is a status somebody sets. Each job's position is worked out
// from its files and its payment record every time the board loads, so it
// cannot drift the way a column of cards moved by hand does.

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, ClipboardList, RefreshCw } from 'lucide-react';
import { fetchJobBoardRows } from '../data-service';
import { buildBoard, boardSummary, CHASE_AFTER_DAYS } from '../utils/jobBoard';
import * as ui from '../ui/theme';

// Each bucket gets its own colour so the shape of the backlog reads before any
// of the words do — a tall amber column means something different at a glance
// from a tall green one.
const TONES = {
  created: ui.TONE.warn,
  serviceReport: ui.TONE.violet,
  invoice: ui.TONE.pink,
  packet: ui.TONE.ok,
  sent: ui.TONE.brand,
  paid: '#0ea5e9',
};

export default function JobBoard({ colors, onOpen }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await fetchJobBoardRows());
    } catch (err) {
      setError(err.message || String(err));
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Rebuilt against the clock at render, not stored: "37 days waiting" has to
  // be 38 tomorrow without anybody re-saving anything.
  const board = useMemo(() => (rows ? buildBoard(rows, new Date()) : null), [rows]);

  const card = ui.card(colors, { padding: '14px 16px', marginBottom: '10px' });

  const Row = ({ r, tone }) => (
    <button
      type="button"
      onClick={() => onOpen && onOpen(r.sr)}
      style={{
        display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
        padding: '10px 12px', marginBottom: '6px', textAlign: 'left',
        background: colors.cardBg, color: colors.text, cursor: 'pointer',
        border: `1px solid ${colors.border}`, borderLeft: `3px solid ${tone}`,
        borderRadius: '8px', flexWrap: 'wrap',
      }}
    >
      <strong style={{ fontVariantNumeric: 'tabular-nums', minWidth: '72px' }}>{r.sr}</strong>
      <span style={{ flex: '1 1 160px', color: colors.text }}>{r.customer || 'Customer not recorded'}</span>
      {r.date && (
        <span style={{ color: colors.textSecondary, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>{r.date}</span>
      )}

      {/* How long it has been waiting, but only where that means something.
          A job that has not been sent has nothing to count from. */}
      {r.waitingDays != null && (
        <span style={{
          fontSize: '12px', fontVariantNumeric: 'tabular-nums',
          color: r.chase ? ui.TONE.bad : colors.textSecondary,
          fontWeight: r.chase ? 600 : 400,
        }}>
          {r.chase && <AlertTriangle size={12} style={{ verticalAlign: '-2px', marginRight: '3px' }} />}
          {r.waitingDays} day{r.waitingDays === 1 ? '' : 's'}
        </span>
      )}

      <span style={{ color: colors.textSecondary, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>
        {r.progress.done}/{r.progress.total}
      </span>
      <ArrowRight size={14} style={{ color: colors.textSecondary }} />
    </button>
  );

  return (
    <div style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '12px', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 600, color: colors.text, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ClipboardList size={22} /> Open jobs
        </h2>
        <button
          type="button" onClick={load} disabled={loading}
          style={ui.btn(colors, { over: { display: 'flex', alignItems: 'center', gap: '6px' } })}
        >
          <RefreshCw size={14} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ ...card, borderLeft: `3px solid ${ui.TONE.bad}`, color: colors.text }}>
          Could not load the board: {error}
        </div>
      )}

      {loading && !board && (
        <div style={{ ...card, color: colors.textSecondary }}>Working out where every job has got to…</div>
      )}

      {board && (
        <>
          <div style={{ color: colors.textSecondary, fontSize: '14px', marginBottom: '14px' }}>
            {boardSummary(board)}
          </div>

          {/* An empty board is a real answer, and a good one. Saying so beats a
              blank page that reads as something having failed to load. */}
          {board.groups.length === 0 && (
            <div style={{ ...card, color: colors.textSecondary }}>
              Nothing open — every job is invoiced, sent and paid.
            </div>
          )}

          {board.groups.map((g) => (
            <section key={g.key} style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <span style={ui.pill(TONES[g.key] || ui.TONE.brand)}>{g.rows.length}</span>
                <strong style={{ color: colors.text, fontSize: '15px' }}>{g.label}</strong>
                <span style={{ color: colors.textSecondary, fontSize: '13px' }}>{g.hint}</span>
              </div>
              {g.rows.map((r) => <Row key={r.sr} r={r} tone={TONES[g.key] || ui.TONE.brand} />)}
            </section>
          ))}

          {board.done.length > 0 && (
            <section>
              <button
                type="button" onClick={() => setShowDone((v) => !v)}
                style={ui.btn(colors, { size: 'sm' })}
              >
                {showDone ? 'Hide' : 'Show'} {board.done.length} finished job{board.done.length === 1 ? '' : 's'}
              </button>
              {showDone && (
                <div style={{ marginTop: '10px' }}>
                  {board.done.map((r) => <Row key={r.sr} r={r} tone={colors.border} />)}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
