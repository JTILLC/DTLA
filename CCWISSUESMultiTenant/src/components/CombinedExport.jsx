import { useState, useEffect, useRef } from 'react';
import { useBodyScrollLock } from '../utils/useBodyScrollLock.js';

// Merge Line Report + Span Calibration + Audit into one PDF, with any section excluded.
export default function CombinedExport({ line, buildPdf, onClose }) {
  useBodyScrollLock();
  const [opts, setOpts] = useState({ dashboard: true, span: true, audit: true });
  const [pdfUrl, setPdfUrl] = useState('');
  const urlRef = useRef('');

  const anySelected = opts.dashboard || opts.span || opts.audit;

  useEffect(() => {
    if (!anySelected) { setPdfUrl(''); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const doc = await buildPdf(line, opts);
        if (cancelled) return;
        const url = doc.output('bloburl');
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setPdfUrl(url);
      } catch (err) {
        console.error('Combined export failed:', err);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [opts, line, buildPdf, anySelected]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const toggle = (k) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  const handleDownload = async () => {
    const doc = await buildPdf(line, opts);
    const safe = (line.serialNumber || line.title || 'line').replace(/[^a-z0-9]/gi, '-');
    doc.save(`${safe}-report.pdf`);
  };

  const check = (k, label) => (
    <label style={{ display: 'block', marginBottom: '8px' }}>
      <input type="checkbox" checked={opts[k]} onChange={() => toggle(k)} /> {label}
    </label>
  );

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="modal-dialog modal-xl modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Export Combined PDF — {line.title}</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
          </div>
          <div className="modal-body">
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 220px', minWidth: '220px' }}>
                <h6>Include sections</h6>
                {check('dashboard', 'Line Report (dashboard)')}
                {check('span', 'Span Calibration')}
                {check('audit', 'Audit')}
                {!anySelected && <p style={{ color: '#c00', fontSize: '0.85em' }}>Select at least one section.</p>}
                <p style={{ fontSize: '0.78em', color: '#888', marginTop: '10px' }}>
                  Span Calibration here uses the saved data (no signatures). For a signed
                  certificate, use the dedicated “Span Calibration PDF…” preview.
                </p>
              </div>
              <div style={{ flex: '2 1 420px', minWidth: '320px' }}>
                {pdfUrl ? (
                  <iframe
                    title="Combined export preview"
                    src={pdfUrl}
                    style={{ width: '100%', height: '74vh', border: '1px solid #ccc', borderRadius: '4px' }}
                  />
                ) : (
                  <div style={{ padding: '20px' }}>{anySelected ? 'Generating preview…' : 'Nothing to preview.'}</div>
                )}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
            <button className="btn btn-success" onClick={handleDownload} disabled={!anySelected}>Download PDF</button>
          </div>
        </div>
      </div>
    </div>
  );
}
