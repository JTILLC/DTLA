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
import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, FolderUp, Upload } from 'lucide-react';
import { addPacketFile, fetchPacket, updatePacketFile } from '../data-service';
import { planImport, summarise } from '../utils/bulkReceipts';
import { scanReceipt } from '../utils/scanReceipt';
import { money } from '../utils/jobPacket';
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

  const byJob = useMemo(() => {
    const map = new Map();
    (plan?.matched || []).forEach((m) => map.set(m.sr, (map.get(m.sr) || 0) + 1));
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [plan]);

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
        const entry = await addPacketFile(item.sr, 'receipts', item.file);
        uploaded += 1;

        if (scan && /^image\//.test(item.file.type || '')) {
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
        <div style={{ marginTop: '14px' }}>
          <div style={{ color: colors.text, fontWeight: 600, marginBottom: '8px' }}>
            {summarise(plan)}
          </div>

          {byJob.length > 0 && (
            <div style={{ overflowX: 'auto', maxHeight: '220px', overflowY: 'auto', marginBottom: '10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '320px' }}>
                <tbody>
                  {byJob.map(([sr, n]) => (
                    <tr key={sr}>
                      <td style={{ ...cell, color: colors.text }}>{sr}</td>
                      <td style={{ ...cell, color: colors.textSecondary, textAlign: 'right' }}>
                        {n} receipt{n === 1 ? '' : 's'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {plan.unmatched.length > 0 && (
            <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', fontSize: '13px', color: ui.TONE.warn, marginBottom: '8px' }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
              {/* Named, not hidden: these are the ones a person has to decide
                  about, and a count alone sends them hunting. */}
              <span>
                No job could be read for {plan.unmatched.length}:{' '}
                {plan.unmatched.slice(0, 4).map((u) => u.path).join(', ')}
                {plan.unmatched.length > 4 ? ` and ${plan.unmatched.length - 4} more` : ''}.
                These are left out — put them in a folder named for their job and run it again.
              </span>
            </div>
          )}

          {plan.skipped.length > 0 && (
            <div style={{ fontSize: '13px', color: colors.textSecondary, marginBottom: '8px' }}>
              {plan.skipped.length} skipped ({[...new Set(plan.skipped.map((s) => s.reason))].join('; ')}).
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: colors.text, marginBottom: '10px' }}>
            <input type="checkbox" checked={scan} onChange={(e) => setScan(e.target.checked)} />
            Also read the vendor and amount off each one
            <span style={{ color: colors.textSecondary }}>
              — slower and costs a few cents each; the image is the record either way
            </span>
          </label>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button" onClick={run} disabled={!!running || !plan.matched.length}
              style={ui.btn(colors, { tone: ui.TONE.violet, active: true, over: { opacity: running ? 0.6 : 1 } })}
            >
              {running || `Load ${plan.matched.length} receipt${plan.matched.length === 1 ? '' : 's'}`}
            </button>
            <button type="button" onClick={() => setPlan(null)} style={ui.btn(colors)}>Cancel</button>
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
