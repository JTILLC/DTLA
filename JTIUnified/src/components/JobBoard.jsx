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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, ClipboardList, RefreshCw, Trash2, Upload } from 'lucide-react';
import { fetchJobBoardRows, addPacketFile, removePacketFile, releaseJobNumber, fetchPacket, fetchExcludedReports, fetchServiceQuotes, setQuoteSr, markJobComplete } from '../data-service';
import { normalizeSr } from '../utils/srMatch';
import { buildBoard, boardSummary, CHASE_AFTER_DAYS } from '../utils/jobBoard';
import { describeUnsupported } from '../utils/jobPacket';
import { completionPlan, describePlan } from '../utils/completeJob';
import * as ui from '../ui/theme';
import { isSameCustomer } from '@shared/utils/customerMatch.js';
import { formatDate } from '../utils/format';

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
  const [showClosed, setShowClosed] = useState(false);
  const [uploading, setUploading] = useState(null);   // `${sr}:${kind}` in flight
  const [releasing, setReleasing] = useState(null);   // sr being deleted

  // The two buckets that exist because a document is missing are the two where
  // producing the document is the whole job. Sending somebody to another screen
  // to do the thing this screen just asked for is the long way round.
  const UPLOADABLE = { serviceReport: 'service report', invoice: 'invoice' };

  const upload = async (sr, kind, fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const bad = files.map(describeUnsupported).filter(Boolean);
    if (bad.length) { setError(bad.join(' ')); return; }
    setError('');
    setUploading(`${sr}:${kind}`);
    try {
      for (const f of files) await addPacketFile(sr, kind, f);
      // The job moves bucket the moment the file lands, so the whole board is
      // re-derived rather than the row being patched in place.
      await load();
    } catch (err) {
      setError(err.message || String(err));
    }
    setUploading(null);
  };

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

  /**
   * Delete a job and put its number back in the pool.
   *
   * Only offered where `blockers` is empty — nothing filed, nothing invoiced,
   * nothing in the Tracker. A number that HAS been written on something is
   * closed instead, on the packet page, because handing it out twice cannot be
   * undone in any of the four systems that key on it.
   *
   * The file list is read fresh rather than taken from the row: the board's
   * copy was assembled when it last loaded, and deleting the packet record
   * while a file it never saw is still in storage would orphan that file.
   */
  const release = async (sr) => {
    const packet = await fetchPacket(sr).catch(() => ({ files: [] }));
    const files = packet.files || [];
    if (!window.confirm(
      `Delete ${sr} and put the number back in the pool?\n\n`
      + 'The job record and its entry in the Jobs Tracker will be deleted.\n'
      + (files.length
        ? `The ${files.length} file${files.length === 1 ? '' : 's'} attached to it will be deleted.\n`
        : '')
      + `\n${sr} becomes the next number offered again. This cannot be undone.`)) return;
    setError('');
    setReleasing(sr);
    try {
      // Files first: releasing deletes the record that lists them, so leaving
      // them until afterwards would strand them in storage with nothing
      // pointing at them.
      for (const f of files) {
        if (f.path) await removePacketFile(sr, f.path);
      }
      await releaseJobNumber(sr);
      await load();
    } catch (err) {
      setError(err.message || String(err));
    }
    setReleasing(null);
  };

  useEffect(() => { load(); }, []);

  // Rebuilt against the clock at render, not stored: "37 days waiting" has to
  // be 38 tomorrow without anybody re-saving anything.
  // Finding one number on a board of 177.
  //
  // Rows inside a group are ordered longest-waiting first, which is right for
  // chasing and wrong for looking something up: a job created today sits
  // wherever its wait puts it, part way down a column of fifty. Three jobs
  // created minutes earlier read as missing twice over before this existed.
  // Filtering rather than reordering, so the chase order it exists for is
  // left exactly as it is.
  const [find, setFind] = useState('');
  // Numbers set aside belong nowhere that asks "what still needs doing" —
  // that is the whole point of setting one aside, and leaving it here put a
  // number somebody had deliberately shelved at the very top of the board.
  const [excluded, setExcluded] = useState(new Map());
  useEffect(() => { fetchExcludedReports().then(setExcluded).catch(() => {}); }, []);

  const board = useMemo(() => {
    if (!rows) return null;
    const q = find.trim().toLowerCase();
    const live = rows.filter((r) => !excluded.has(normalizeSr(r.sr)));
    const matching = q
      ? live.filter((r) => String(r.sr || '').toLowerCase().includes(q)
        || String(r.customer || '').toLowerCase().includes(q))
      : live;
    return buildBoard(matching, new Date());
  }, [rows, find, excluded]);

  const card = ui.card(colors, { padding: '14px 16px', marginBottom: '10px' });

  // Quotes, so a job can say what it was priced at — and so one that was never
  // connected can be, from the board where the job is already in front of you
  // rather than in the quote app from memory.
  const [quotes, setQuotes] = useState([]);
  const [linking, setLinking] = useState('');       // sr being connected
  useEffect(() => {
    fetchServiceQuotes().then(setQuotes).catch((e) => console.warn('Quotes unavailable:', e));
  }, []);

  const quoteFor = useCallback((sr) => {
    const key = String(sr || '').trim();
    const mine = quotes.filter((q) => String(q.sr || '').trim() === key);
    if (!mine.length) return null;
    // Two quotes against one number is two lots of agreed work, so they add up.
    return {
      total: mine.reduce((sum, q) => sum + (q.total || 0), 0),
      numbers: mine.map((q) => q.quoteNumber).filter(Boolean),
      paths: mine.map((q) => q.path),
    };
  }, [quotes]);

  // Mark one job complete: write whatever it still has outstanding.
  //
  // Per row rather than per bucket, and never in bulk — this asserts that an
  // invoice was raised and that the customer PAID, and those are claims about
  // the outside world that deserve one deliberate press each.
  const [completing, setCompleting] = useState('');
  const completeJob = async (r) => {
    const plan = completionPlan(r);
    if (plan.blocked && !plan.steps.length) { setError(plan.blocked); return; }
    if (!plan.steps.length) { setError(`${r.sr} is already complete.`); return; }
    // The confirm lists every claim being made, because pressing this is the
    // only evidence any of them will ever have.
    if (!window.confirm(describePlan(plan, r.sr))) return;

    setCompleting(r.sr);
    setError('');
    try {
      await markJobComplete(r, plan);
      await load();
    } catch (err) {
      setError(`Could not finish ${r.sr}: ${err?.message || err}`);
    }
    setCompleting('');
  };

  const disconnectQuotes = async (sr, paths, total) => {
    if (!window.confirm(
      `Disconnect the $${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} quote from ${sr}?\n\n`
      + 'The quote itself is untouched — it just stops being attached to this job, '
      + 'and the timesheet stops counting down against it.'
    )) return;
    setLinking(sr);
    setError('');
    try {
      for (const path of paths) await setQuoteSr(path, '');
      setQuotes(await fetchServiceQuotes());
    } catch (err) {
      setError(`Could not disconnect the quote: ${err?.message || err}`);
    }
    setLinking('');
  };

  const connectQuote = async (sr, path) => {
    setLinking(sr);
    setError('');
    try {
      await setQuoteSr(path, sr);
      setQuotes(await fetchServiceQuotes());
    } catch (err) {
      setError(`Could not connect the quote: ${err?.message || err}`);
    }
    setLinking('');
  };

  const Row = ({ r, tone, groupKey }) => {
    const kind = UPLOADABLE[groupKey];
    const busy = uploading === `${r.sr}:${groupKey}`;
    const gone = releasing === r.sr;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
        marginBottom: '6px', background: colors.cardBg,
        border: `1px solid ${colors.border}`, borderLeft: `3px solid ${tone}`,
        borderRadius: '8px', flexWrap: 'wrap', paddingRight: kind ? '8px' : 0,
      }}>
        <button
          type="button"
          onClick={() => onOpen && onOpen(r.sr)}
          style={{
            display: 'flex', alignItems: 'center', gap: '12px', flex: '1 1 260px',
            padding: '10px 12px', textAlign: 'left', background: 'transparent',
            color: colors.text, cursor: 'pointer', border: 0, borderRadius: '8px', flexWrap: 'wrap',
          }}
        >
          <strong style={{ fontVariantNumeric: 'tabular-nums', minWidth: '72px' }}>{r.sr}</strong>
          <span style={{ flex: '1 1 160px', color: colors.text }}>{r.customer || 'Customer not recorded'}</span>
          {/* Dates arrive in whatever shape their source stored them — a visit
              keeps a full ISO timestamp, and printing that raw put
              "2026-08-12T15:22:28.219Z" in a column two characters wide. */}
          {r.date && (
            <span style={{ color: colors.textSecondary, fontSize: '12px', fontVariantNumeric: 'tabular-nums' }}>{formatDate(r.date)}</span>
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

        {/* What this job was quoted at — the figure the timesheet counts down
            against. Outside the button for the same reason the upload control
            is: a select nested in a button cannot be used. */}
        {(() => {
          const q = quoteFor(r.sr);
          // Everything not yet spoken for, this plant's first.
          //
          // It used to be this plant's ONLY, which made the control vanish from
          // almost every row — the customer on a quote is typed in a different
          // app and rarely matches a job's spelling exactly, so "no quotes for
          // this plant" was usually wrong. Ordering says which are likely;
          // hiding the rest just meant the answer could not be given.
          const free = quotes.filter((x) => !String(x.sr || '').trim());
          const mine = r.customer ? free.filter((x) => isSameCustomer(x.customer, r.customer)) : [];
          const others = free.filter((x) => !mine.includes(x));
          const label = (x) => [
            x.quoteNumber || 'Unnumbered',
            `$${(x.total || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            x.customer, x.date,
          ].filter(Boolean).join(' · ');

          if (q) {
            return (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0, padding: '0 4px' }}>
                <span
                  style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: colors.textSecondary }}
                  title={q.numbers.length ? `Quote ${q.numbers.join(', ')} — the timesheet counts down against this` : 'Quoted'}
                >
                  quoted ${q.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                {/* Connected to the wrong job is a thing that will happen, and a
                    figure a timesheet budgets against must be removable by the
                    person who can see it is wrong. */}
                <button
                  type="button"
                  disabled={linking === r.sr}
                  onClick={() => disconnectQuotes(r.sr, q.paths, q.total)}
                  style={{ border: 0, background: 'transparent', color: colors.textSecondary, cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: '2px 4px' }}
                  title={`Disconnect this quote from ${r.sr}`}
                  aria-label={`Disconnect the quote from ${r.sr}`}
                >
                  ×
                </button>
              </span>
            );
          }
          if (!free.length) return null;
          return (
            <select
              value=""
              disabled={linking === r.sr}
              onChange={(e) => { if (e.target.value) connectQuote(r.sr, e.target.value); }}
              style={{
                flexShrink: 0, fontSize: '12px', padding: '4px 6px', borderRadius: '6px',
                border: `1px solid ${colors.border}`, background: colors.cardBg, color: colors.textSecondary,
                maxWidth: '190px',
              }}
              title={`Connect a quote to ${r.sr}`}
            >
              <option value="">{linking === r.sr ? 'Connecting…' : 'Connect quote…'}</option>
              {mine.length > 0 && (
                <optgroup label={r.customer}>
                  {mine.map((x) => <option key={x.path} value={x.path}>{label(x)}</option>)}
                </optgroup>
              )}
              {others.length > 0 && (
                <optgroup label={mine.length ? 'Other quotes' : 'Unconnected quotes'}>
                  {others.map((x) => <option key={x.path} value={x.path}>{label(x)}</option>)}
                </optgroup>
              )}
            </select>
          );
        })()}

        {/* Done, all of it. Sits at the end of the row because it is the least
            used and the most consequential thing there. */}
        <button
          type="button"
          disabled={completing === r.sr}
          onClick={() => completeJob(r)}
          style={{
            flexShrink: 0, fontSize: '12px', fontWeight: 600, padding: '6px 10px',
            borderRadius: '6px', border: `1px solid ${colors.border}`,
            background: 'transparent', color: completing === r.sr ? colors.textSecondary : ui.TONE.ok,
            cursor: completing === r.sr ? 'wait' : 'pointer', whiteSpace: 'nowrap',
          }}
          title={`Mark ${r.sr} complete — records the steps it still needs, including paid`}
        >
          <Check size={12} style={{ verticalAlign: '-2px' }} /> {completing === r.sr ? 'Marking…' : 'Complete'}
        </button>

        {/* Outside the button, not inside it: a label wrapping a file input
            nested in a button is invalid, and its click would open the packet
            as well as the file picker. */}
        {kind && (
          <label
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', flexShrink: 0,
              fontSize: '12px', fontWeight: 600, padding: '6px 10px', borderRadius: '6px',
              border: `1px solid ${colors.border}`, background: colors.cardBg,
              color: busy ? colors.textSecondary : tone, cursor: busy ? 'wait' : 'pointer',
            }}
            title={`Upload the ${kind} for ${r.sr}`}
          >
            <Upload size={12} /> {busy ? 'Uploading…' : `Add ${kind}`}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              disabled={busy}
              onChange={(e) => { upload(r.sr, groupKey, e.target.files); e.target.value = ''; }}
              style={{ display: 'none' }}
            />
          </label>
        )}

        {/* Only where nothing has been filed against the number. A job started
            by mistake this morning is the case this exists for; anything that
            has reached a report, an invoice or the Tracker is closed on the
            packet page instead, where there is room to explain the difference. */}
        {r.blockers && r.blockers.length === 0 && (
          <button
            type="button"
            disabled={gone}
            onClick={() => release(r.sr)}
            title={`Delete ${r.sr} and put the number back in the pool`}
            aria-label={`Delete ${r.sr} and put the number back in the pool`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', flexShrink: 0,
              fontSize: '12px', padding: '6px 8px', borderRadius: '6px',
              border: `1px solid ${colors.border}`, background: colors.cardBg,
              color: gone ? colors.textSecondary : ui.TONE.bad,
              cursor: gone ? 'wait' : 'pointer', marginRight: kind ? 0 : '8px',
            }}
          >
            <Trash2 size={12} /> {gone ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', gap: '12px', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '24px', fontWeight: 600, color: colors.text, margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ClipboardList size={22} /> Open jobs
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type="search" value={find} onChange={(e) => setFind(e.target.value)}
            placeholder="Find a number or customer…"
            aria-label="Find a job on this board"
            style={{ ...ui.input(colors), width: '220px' }}
          />
          <button
            type="button" onClick={load} disabled={loading}
            style={ui.btn(colors, { over: { display: 'flex', alignItems: 'center', gap: '6px' } })}
          >
            <RefreshCw size={14} /> {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
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
            {/* While filtering, the usual summary would describe the filtered
                set as though it were the whole board. */}
            {find.trim()
              ? <>Showing jobs matching &ldquo;{find.trim()}&rdquo;. <button type="button" onClick={() => setFind('')}
                  style={{ background: 'none', border: 0, color: '#3b82f6', cursor: 'pointer', padding: 0, font: 'inherit' }}>Show all</button></>
              : boardSummary(board)}
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
              {g.rows.map((r) => <Row key={r.sr} r={r} tone={TONES[g.key] || ui.TONE.brand} groupKey={g.key} />)}
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

          {/* Behind a toggle rather than gone. Closing means the job is not
              happening, so it does not belong in "what needs doing" — but the
              number is still spoken for, and one closed with an invoice
              outstanding is exactly the thing that should not disappear. */}
          {board.closed.length > 0 && (
            <section style={{ marginTop: '10px' }}>
              <button
                type="button" onClick={() => setShowClosed((v) => !v)}
                style={ui.btn(colors, { size: 'sm' })}
              >
                {showClosed ? 'Hide' : 'Show'} {board.closed.length} closed number{board.closed.length === 1 ? '' : 's'}
              </button>
              {showClosed && (
                <>
                  <div style={{ color: colors.textSecondary, fontSize: '12px', margin: '8px 0 6px' }}>
                    Cancelled jobs. The number stays spent so nothing else can take it —
                    reopen one from its packet page.
                  </div>
                  {board.closed.map((r) => <Row key={r.sr} r={r} tone={ui.TONE.warn} />)}
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
