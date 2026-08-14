// src/components/BackupPanel.jsx
//
// Take a copy of everything, and put one back.
//
// All of this existed already — backupAllApps, the four importers, 373 lines of
// it — and nothing in the app called any of it. There was no button. So the
// answer to "can we get the data back" was no, in a codebase that had been
// written as though the answer were yes.
//
// Restoring is the dangerous direction and is treated as such: the file is read
// and described BEFORE anything is written, the description says what will be
// overwritten and how old the file is, and the destructive ones need a separate
// acknowledgement. Nothing here happens as a side effect of choosing a file.

import React, { useState } from 'react';
import { AlertTriangle, Download, HardDriveDownload, Upload } from 'lucide-react';
import {
  backupCCWIssues, backupShearers, backupTimesheet, backupJobs, backupAllApps,
  readBackupFile, importBackupFromFile,
} from '../backup-service';
import { describePlan } from '../utils/backupShape';
import { auth } from '../firebase-config';
import * as ui from '../ui/theme';

// The Worker that holds the service accounts and runs the nightly job.
const BROKER = 'https://ccw-media.josh-c80.workers.dev';

const APPS = [
  { key: 'all', label: 'Everything', hint: 'All four, one file each', fn: backupAllApps },
  { key: 'ccw', label: 'CCW Issues', hint: 'Customers and visits', fn: backupCCWIssues },
  { key: 'timesheet', label: 'Timesheets', hint: 'Every sheet and its days', fn: backupTimesheet },
  { key: 'jobs', label: 'Jobs Tracker', hint: 'Every year file', fn: backupJobs },
  { key: 'shearers', label: 'Shearers downtime', hint: 'The whole logger tree', fn: backupShearers },
];

export default function BackupPanel({ colors }) {
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState([]);
  const [pending, setPending] = useState(null);   // { file, backup, plan }
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [manifest, setManifest] = useState(null);
  const [progress, setProgress] = useState('');

  // Run the scheduled job now, rather than waiting for 02:00 to find out
  // whether it works. Authorised with the signed-in user's own token: the
  // Worker checks the same `admin` claim it uses for creating logins, because
  // this reads every collection in two projects.
  // One project per request, in sequence.
  //
  // All four in a single call needed more subrequests than a Worker invocation
  // is allowed. When it blew the limit, Cloudflare answered with an error page
  // carrying no CORS headers, so the browser said only "failed to fetch" — a
  // message that describes the symptom and hides the cause. Asking for one
  // project at a time keeps each call well inside the allowance, and shows each
  // result as it lands instead of after the lot.
  const PROJECTS = [
    { only: 'downtimelogger-a96fb', label: 'CCW Issues' },
    { only: 'jobs-data-17ee4', label: 'Jobs and packets' },
    { only: 'timesheetapp-c4e54', label: 'Timesheets' },
    { only: 'shearers-4c4b4', label: 'Shearers downtime' },
  ];

  const runNightlyNow = async () => {
    setBusy('nightly'); setError(''); setManifest(null);
    const merged = { results: [], bucket: '', retention: null };
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Sign in first.');
      const token = await user.getIdToken();

      for (const p of PROJECTS) {
        setProgress(p.label);
        // Each project in its OWN try. A request that dies outright — the
        // Worker killed for memory, which no amount of error handling inside it
        // can catch — threw here and abandoned the remaining projects, so one
        // oversized collection cost three good backups.
        try {
          const res = await fetch(`${BROKER}/admin/run-backup?only=${encodeURIComponent(p.only)}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          const text = await res.text();
          if (!res.ok) {
            merged.results.push({ name: p.label, ok: false, error: text || `worker answered ${res.status}` });
          } else {
            const m = JSON.parse(text);
            if (m.fatal) merged.results.push({ name: p.label, ok: false, error: m.fatal });
            else merged.results.push(...m.results);
            merged.bucket = m.bucket || merged.bucket;
            merged.retention = m.retention || merged.retention;
          }
        } catch (err) {
          merged.results.push({
            name: p.label, ok: false,
            error: `${err.message || err} — the request died rather than answering, which usually means this project holds more data than one run can carry.`,
          });
        }
        setManifest({ ...merged });
      }
    } catch (err) {
      setError(err.message || String(err));
    }
    setProgress('');
    setBusy('');
  };

  const say = (m) => setLog((l) => [m, ...l].slice(0, 8));

  const runBackup = async (app) => {
    setBusy(app.key); setError('');
    try { await app.fn(say); } catch (err) { setError(err.message || String(err)); }
    setBusy('');
  };

  // Reading is separate from restoring on purpose: you see what a file would do
  // before it does it.
  const choose = async (file) => {
    setError(''); setAck(false); setPending(null);
    if (!file) return;
    try {
      const { backup, plan } = await readBackupFile(file);
      setPending({ file, backup, plan });
    } catch (err) {
      setError(`That file could not be read: ${err.message || err}`);
    }
  };

  const restore = async () => {
    if (!pending?.plan?.valid) return;
    setBusy('restore'); setError('');
    try {
      const r = await importBackupFromFile(pending.file, say, { replaceEverything: ack });
      if (!r?.success) setError(r?.error || 'The restore did not complete.');
      setPending(null); setAck(false);
    } catch (err) {
      setError(err.message || String(err));
    }
    setBusy('restore-done');
    setBusy('');
  };

  const card = ui.card(colors, { padding: '18px', marginBottom: '16px' });
  const destructive = pending?.plan?.warnings?.some((w) => /REPLACES|replaced whole/.test(w));

  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: '24px', fontWeight: 600, color: colors.text, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <HardDriveDownload size={22} /> Backups
      </h2>
      <p style={{ color: colors.textSecondary, fontSize: '14px', margin: '0 0 18px' }}>
        Each backup downloads as a JSON file to this computer. Keep them somewhere that
        is not this computer — a backup on the same disk as the data is not a backup.
      </p>

      <div style={card}>
        <div style={ui.label(colors)}>Take a copy</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
          {APPS.map((a) => (
            <button
              key={a.key} type="button" onClick={() => runBackup(a)} disabled={!!busy}
              title={a.hint}
              style={ui.btn(colors, {
                tone: a.key === 'all' ? ui.TONE.ok : undefined,
                active: a.key === 'all',
                over: { display: 'flex', alignItems: 'center', gap: '6px', opacity: busy ? 0.6 : 1 },
              })}
            >
              <Download size={14} /> {busy === a.key ? 'Working…' : a.label}
            </button>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={ui.label(colors)}>Nightly backup</div>
        <p style={{ color: colors.textSecondary, fontSize: '13px', margin: '8px 0 12px' }}>
          Runs by itself at 02:00 Arizona time, into the CCW storage bucket under
          <code style={{ margin: '0 4px' }}>backups/</code>. Run it now to see whether it works,
          rather than finding out on the night you need it.
        </p>
        <button type="button" onClick={runNightlyNow} disabled={!!busy}
          style={ui.btn(colors, { over: { display: 'inline-flex', alignItems: 'center', gap: '6px', opacity: busy ? 0.6 : 1 } })}>
          <HardDriveDownload size={14} /> {busy === 'nightly' ? `Backing up ${progress || '…'}` : 'Run the nightly backup now'}
        </button>

        {manifest && (
          <div style={{ marginTop: '14px' }}>
            {manifest.results.map((r) => (
              <div key={r.name} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '6px 0', borderTop: `1px solid ${colors.border}` }}>
                <span style={{
                  flexShrink: 0, fontSize: '12px', fontWeight: 700, marginTop: '1px',
                  color: r.ok ? ui.TONE.ok : r.skipped ? colors.textSecondary : ui.TONE.bad,
                }}>
                  {r.ok ? 'OK' : r.skipped ? 'SKIPPED' : 'FAILED'}
                </span>
                <span style={{ fontSize: '13px', color: colors.text, flex: 1 }}>
                  <strong>{r.name}</strong>
                  {r.ok && <> — {r.documents} documents{r.megabytes ? `, ${r.megabytes} MB` : ''} → <code>{r.path}</code></>}
                  {r.authenticated === false && <span style={{ color: '#92400e' }}> (read without credentials)</span>}
                  {r.truncated && <span style={{ color: '#92400e' }}> — stopped early ({r.truncated})</span>}
                  {(r.reason || r.error) && <span style={{ color: colors.textSecondary }}> — {r.reason || r.error}</span>}
                  {r.failed?.length > 0 && <div style={{ color: '#92400e', fontSize: '12px' }}>{r.failed.join('; ')}</div>}
                  {/* Collections that exist and are not being backed up. A
                      backup that looks complete and is not is the failure this
                      whole thing exists to prevent, so it is stated. */}
                  {/* Written to their own files rather than into the project
                      dump, because they do not fit in one. */}
                  {r.chunks && Object.keys(r.chunks).length > 0 && (
                    <div style={{ color: colors.textSecondary, fontSize: '12px', marginTop: '2px' }}>
                      {Object.entries(r.chunks).map(([c, n]) => `${c}: ${n} file${n === 1 ? '' : 's'}`).join(' · ')}
                      {r.streamedMegabytes ? `, ${r.streamedMegabytes} MB` : ''}
                    </div>
                  )}
                  {r.oversized?.length > 0 && (
                    <div style={{ color: '#92400e', fontSize: '12px', marginTop: '2px' }}>
                      Too large to include: {r.oversized.join(', ')} — these hold embedded images.
                    </div>
                  )}
                  {r.unconfigured?.length > 0 && (
                    <div style={{ color: '#92400e', fontSize: '12px', marginTop: '2px' }}>
                      NOT backed up: {r.unconfigured.join(', ')} — tell me and I'll add them.
                    </div>
                  )}
                </span>
              </div>
            ))}
            <div style={{ color: colors.textSecondary, fontSize: '12px', marginTop: '8px' }}>
              Written to {manifest.bucket} · {manifest.retention?.skipped || `${manifest.retention?.deleted ?? 0} old files removed`}
            </div>
          </div>
        )}
      </div>

      <div style={{ ...card, borderLeft: `3px solid ${ui.TONE.warn}` }}>
        <div style={ui.label(colors)}>Put one back</div>
        <p style={{ color: colors.textSecondary, fontSize: '13px', margin: '8px 0 12px' }}>
          Restoring overwrites what is there now. Choosing a file only reads it — nothing
          is written until you say so.
        </p>

        <label style={ui.btn(colors, { over: { display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer' } })}>
          <Upload size={14} /> Choose a backup file
          <input type="file" accept="application/json,.json" style={{ display: 'none' }}
                 onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
        </label>

        {pending && (
          <div style={{ marginTop: '14px', padding: '12px', borderRadius: '8px', border: `1px solid ${colors.border}` }}>
            <div style={{ color: colors.text, fontWeight: 600, fontSize: '14px' }}>
              {describePlan(pending.plan)}
            </div>
            {pending.plan.timestamp && (
              <div style={{ color: colors.textSecondary, fontSize: '12px', marginTop: '2px' }}>
                Taken {new Date(pending.plan.timestamp).toLocaleString()}
              </div>
            )}

            {pending.plan.warnings.map((w) => (
              <div key={w} style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginTop: '8px', color: '#92400e', fontSize: '13px' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '2px' }} /> {w}
              </div>
            ))}

            {/* A separate, deliberate act for the ones that delete. */}
            {pending.plan.valid && destructive && (
              <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginTop: '12px', color: colors.text, fontSize: '13px', cursor: 'pointer' }}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: '3px' }} />
                I understand anything recorded since this file was made will be lost.
              </label>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
              <button
                type="button" onClick={restore}
                disabled={!pending.plan.valid || (destructive && !ack) || busy === 'restore'}
                style={ui.btn(colors, {
                  tone: ui.TONE.bad, active: true,
                  over: { opacity: (!pending.plan.valid || (destructive && !ack)) ? 0.5 : 1 },
                })}
              >
                {busy === 'restore' ? 'Restoring…' : 'Restore this file'}
              </button>
              <button type="button" onClick={() => { setPending(null); setAck(false); }} style={ui.btn(colors)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ ...card, borderLeft: `3px solid ${ui.TONE.bad}`, color: colors.text, fontSize: '13px' }}>{error}</div>
      )}

      {log.length > 0 && (
        <div style={card}>
          <div style={ui.label(colors)}>What happened</div>
          {log.map((m, i) => (
            <div key={i} style={{ color: i === 0 ? colors.text : colors.textSecondary, fontSize: '13px', marginTop: '4px' }}>{m}</div>
          ))}
        </div>
      )}
    </div>
  );
}
