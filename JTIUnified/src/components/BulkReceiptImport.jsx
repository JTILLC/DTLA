// src/components/BulkReceiptImport.jsx
//
// Load years of already-organised receipts onto their jobs in one go.
//
// Two things shape this. The receipts are filed by job already, so the job is
// READ from the folder rather than inferred — and nothing is uploaded until the
// whole plan has been shown, because a mis-set folder should be caught while it
// is still a table on screen, not after three hundred receipts have landed on
// the wrong jobs.
//
// And the purpose is records rather than billing, so scanning is OFF by
// default. Reading three hundred receipts costs money and the better part of an
// hour, and for an audit trail the image IS the record — the amount is a bonus
// somebody can add to the handful that matter.
import React, { useRef, useState } from 'react';
import { AlertTriangle, Check, FolderUp, Upload } from 'lucide-react';
import { addPacketFile, fetchPacket, updatePacketFile } from '../data-service';
import { planImport, summarise, KINDS, CATEGORIES } from '../utils/bulkReceipts';
import { scanReceipt } from '../utils/scanReceipt';
import * as ui from '../ui/theme';

export default function BulkReceiptImport({ colors, knownSrs = [], onDone }) {
  const [plan, setPlan] = useState(null);
  const [scan, setScan] = useState(false);
  const [running, setRunning] = useState('');
  const [done, setDone] = useState(null);
  const [failures, setFailures] = useState([]);
  const cancelled = useRef(false);

  const choose = (fileList) => {
    setDone(null);
    setFailures([]);
    setPlan(planImport(fileList, knownSrs));
  };

  const run = async () => {
    if (!plan?.matched.length) return;
    cancelled.current = false;
    const problems = [];
    let uploaded = 0;
    let read = 0;

    for (const [i, item] of plan.matched.entries()) {
      if (cancelled.current) break;
      setRunning(`Uploading ${i + 1} of ${plan.matched.length} — ${item.file.name}`);
      try {
        const entry = await addPacketFile(item.sr, item.kind, item.file,
          item.category ? { category: item.category } : {});
        uploaded += 1;

        // Only receipts have an amount worth reading.
        if (scan && item.kind === 'receipts' && /^image\//.test(item.file.type || '')) {
          setRunning(`Reading ${i + 1} of ${plan.matched.length} — ${item.file.name}`);
          try {
            const r = await scanReceipt(item.file);
            const patch = {};
            if (r.vendor) patch.vendor = r.vendor;
            if (r.total != null) patch.amount = String(r.total);
            if (Object.keys(patch).length) { await updatePacketFile(item.sr, entry.path, patch); read += 1; }
          } catch (err) {
            // A failed read must never lose the upload — the receipt is filed,
            // it simply has no figures on it yet.
            problems.push(`${item.file.name}: read failed (${err.message || err})`);
          }
        }
      } catch (err) {
        problems.push(`${item.file.name}: ${err.message || err}`);
      }
    }

    setRunning('');
    setFailures(problems);
    setDone({ uploaded, read, cancelled: cancelled.current, total: plan.matched.length });
    setPlan(null);
    onDone?.();
  };

  const card = ui.card(colors, { marginBottom: '16px' });
  const cell = ui.cell(colors, { padding: '6px 10px', fontSize: '13px' });

  return (
    <div style={{ ...card, borderLeft: `4px solid ${ui.TONE.violet}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <FolderUp size={18} color={colors.textSecondary} />
        <strong style={{ color: colors.text }}>Load past receipts</strong>
      </div>
      <p style={{ color: colors.textSecondary, fontSize: '13px', margin: '0 0 12px' }}>
        Choose the folder your receipts live in. Each job is read from its folder or filename —
        nothing is uploaded until you have seen what will go where.
      </p>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ ...ui.btn(colors, { size: 'sm' }), cursor: 'pointer' }}>
          <FolderUp size={15} /> Choose a folder
          {/* webkitdirectory keeps the relative path, which is what carries the
              job. A plain file picker throws the folder away. */}
          <input
            type="file" webkitdirectory="" directory="" multiple
            onChange={(e) => { choose(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }}
          />
        </label>
        <label style={{ ...ui.btn(colors, { size: 'sm' }), cursor: 'pointer' }}>
          <Upload size={15} /> …or pick files
          <input
            type="file" multiple accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => { choose(e.target.files); e.target.value = ''; }}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {plan && (
        <div
          role="dialog" aria-modal="true" aria-label="Review the import"
          style={{
            position: 'fixed', inset: 0, zIndex: 4000, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: '20px',
            background: 'rgba(0,0,0,0.55)',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setPlan(null); }}
        >
          <div style={{
            background: colors.cardBg, borderRadius: '12px', padding: '20px',
            width: 'min(900px, 100%)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
              <strong style={{ color: colors.text, fontSize: '17px' }}>What is each file?</strong>
              <span style={{ color: colors.textSecondary, fontSize: '13px' }}>{summarise(plan)}</span>
            </div>
            <p style={{ color: colors.textSecondary, fontSize: '13px', margin: '6px 0 10px' }}>
              Each row is a guess from the filename. Correct anything wrong — a purchase order filed
              as a receipt would land in the expense total.
            </p>

            {/* Whole-column setters. Correcting two hundred rows one dropdown at
                a time is how somebody gives up and accepts the guesses. */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '12px', color: colors.textSecondary }}>Set all to:</span>
              {KINDS.map((k) => (
                <button
                  key={k.key} type="button"
                  onClick={() => setPlan((pl) => ({
                    ...pl,
                    matched: pl.matched.map((m) => ({ ...m, kind: k.key, category: k.key === 'receipts' ? m.category : null })),
                  }))}
                  style={ui.btn(colors, { size: 'sm' })}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <div style={{ overflow: 'auto', flex: 1, border: `1px solid ${colors.border}`, borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
                <thead>
                  <tr>
                    {['File', 'Job', 'What it is', 'Expense type'].map((h) => (
                      <th key={h} style={{ ...cell, position: 'sticky', top: 0, background: colors.cardBg,
                        fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em',
                        color: colors.textSecondary, textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan.matched.map((m, i) => (
                    <tr key={m.path + i}>
                      <td style={{ ...cell, color: colors.text }}>{m.file.name}</td>
                      <td style={{ ...cell, color: colors.textSecondary }}>{m.sr}</td>
                      <td style={cell}>
                        <select
                          value={m.kind}
                          aria-label={`What ${m.file.name} is`}
                          onChange={(e) => setPlan((pl) => ({
                            ...pl,
                            matched: pl.matched.map((x, n) => (n === i
                              ? { ...x, kind: e.target.value, category: e.target.value === 'receipts' ? x.category : null }
                              : x)),
                          }))}
                          style={ui.input(colors, { padding: '4px 6px', fontSize: '13px' })}
                        >
                          {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                        </select>
                      </td>
                      <td style={cell}>
                        {m.kind === 'receipts' ? (
                          <select
                            value={m.category || ''}
                            aria-label={`Expense type for ${m.file.name}`}
                            onChange={(e) => setPlan((pl) => ({
                              ...pl,
                              matched: pl.matched.map((x, n) => (n === i ? { ...x, category: e.target.value || null } : x)),
                            }))}
                            style={ui.input(colors, { padding: '4px 6px', fontSize: '13px' })}
                          >
                            <option value="">— not set —</option>
                            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        ) : (
                          <span style={{ color: colors.textSecondary, fontSize: '13px' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {plan.unmatched.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '13px', color: ui.TONE.warn, marginTop: '10px' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>
                  No job could be read for {plan.unmatched.length}:{' '}
                  {plan.unmatched.slice(0, 4).map((u) => u.path).join(', ')}
                  {plan.unmatched.length > 4 ? ` and ${plan.unmatched.length - 4} more` : ''}.
                  These are left out — put them in a folder named for their job and run it again.
                </span>
              </div>
            )}
            {plan.skipped.length > 0 && (
              <div style={{ fontSize: '13px', color: colors.textSecondary, marginTop: '6px' }}>
                {plan.skipped.length} skipped ({[...new Set(plan.skipped.map((sk) => sk.reason))].join('; ')}).
              </div>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: colors.text, margin: '12px 0' }}>
              <input type="checkbox" checked={scan} onChange={(e) => setScan(e.target.checked)} />
              Also read the vendor and amount off each receipt
              <span style={{ color: colors.textSecondary }}>
                — slower and costs a few cents each; the image is the record either way
              </span>
            </label>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button" onClick={run} disabled={!!running || !plan.matched.length}
                style={ui.btn(colors, { tone: ui.TONE.violet, active: true, over: { opacity: running ? 0.6 : 1 } })}
              >
                {running || `Load ${plan.matched.length} file${plan.matched.length === 1 ? '' : 's'}`}
              </button>
              <button type="button" onClick={() => setPlan(null)} style={ui.btn(colors)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {running && (
        <div style={{ marginTop: '10px', fontSize: '13px', color: colors.textSecondary }}>
          {running}{' '}
          <button
            type="button" onClick={() => { cancelled.current = true; }}
            style={{ border: 'none', background: 'transparent', color: ui.TONE.bad, cursor: 'pointer', textDecoration: 'underline' }}
          >
            stop
          </button>
          {/* Stopping leaves everything already uploaded in place. A half-done
              import is not a broken one — the same folder can be run again and
              what is already there is skipped. */}
        </div>
      )}

      {done && (
        <div style={{ marginTop: '12px', fontSize: '14px', color: colors.text, display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
          <Check size={16} color={ui.TONE.ok} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            Loaded {done.uploaded} of {done.total}
            {done.read > 0 && `, read the amount off ${done.read}`}
            {done.cancelled && ' — stopped early; run the same folder again to finish, what is already loaded will be skipped'}.
          </span>
        </div>
      )}

      {failures.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '13px', color: ui.TONE.bad }}>
          {failures.slice(0, 5).join(' · ')}{failures.length > 5 ? ` · and ${failures.length - 5} more` : ''}
        </div>
      )}
    </div>
  );
}
