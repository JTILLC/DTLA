import { useState, useEffect, useRef } from 'react';
import SignatureField from './SignatureField';
import { useBodyScrollLock } from '../utils/useBodyScrollLock.js';

const fmtDate = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;

// Live preview + edit modal for the Span Calibration Certificate.
export default function SpanCalPreview({ line, globalData, buildPdf, onClose, onSave }) {
  useBodyScrollLock();
  const [draft, setDraft] = useState(() => {
    const today = new Date();
    const due = new Date(today); due.setFullYear(due.getFullYear() + 1); due.setDate(due.getDate() - 1);
    return {
      model: line.model || '',
      jobNumber: line.jobNumber || '',
      serialNumber: line.serialNumber || '',
      customerName: line.customerName || globalData?.customer || '',
      customerLocation: line.customerLocation || globalData?.cityState || globalData?.address || '',
      customerContact: line.customerContact || '',
      signerName: line.signerName || '',
      calDate: line.calDate || fmtDate(today),
      calDueDate: line.calDueDate || fmtDate(due),
      spanCalWeight: line.spanCalWeight || '',
      targetWeight: line.targetWeight || '',
      avgWeight100: line.avgWeight100 || '',
      stdDev100: line.stdDev100 || '',
    };
  });
  const [customerSig, setCustomerSig] = useState(null);
  const [calibratorSig, setCalibratorSig] = useState(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const urlRef = useRef('');

  // Rebuild the PDF (debounced) whenever any field, head weight, or signature changes
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const doc = await buildPdf({ ...line, ...draft, _customerSig: customerSig, _calibratorSig: calibratorSig });
        if (cancelled) return;
        const url = doc.output('bloburl');
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setPdfUrl(url);
      } catch (err) {
        console.error('Span calibration preview failed:', err);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [draft, line, buildPdf, customerSig, calibratorSig]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));

  const handleDownload = async () => {
    const persist = { ...line, ...draft }; // text fields persist; signatures stay on the PDF only
    onSave(persist);
    const doc = await buildPdf({ ...persist, _customerSig: customerSig, _calibratorSig: calibratorSig });
    const safe = (persist.serialNumber || persist.title || 'span').replace(/[^a-z0-9]/gi, '-');
    doc.save(`${safe}-span-calibration.pdf`);
  };

  const field = (key, label) => (
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85em', marginBottom: '8px' }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <input type="text" value={draft[key]} onChange={set(key)} className="form-control form-control-sm" />
    </label>
  );

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="modal-dialog modal-xl modal-dialog-centered" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Span Calibration Certificate — Preview</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
          </div>
          <div className="modal-body">
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 240px', minWidth: '240px', maxHeight: '74vh', overflowY: 'auto', paddingRight: '6px' }}>
                <h6>Certificate Details</h6>
                {field('model', 'Model Information')}
                {field('jobNumber', 'Job Number')}
                {field('serialNumber', 'Serial Number')}
                {field('customerName', 'Customer Name')}
                {field('customerLocation', 'Customer Location')}
                {field('customerContact', 'Customer Contact')}
                <hr />
                <h6>Calibration Test</h6>
                {field('spanCalWeight', 'Span Calibration Weight')}
                {field('targetWeight', 'Target Weight for test')}
                {field('avgWeight100', 'Average weight 100 cycles')}
                {field('stdDev100', 'Standard Deviation 100 cycles')}
                <hr />
                <h6>Signatures &amp; Dates</h6>
                {field('signerName', 'Customer Name (printed)')}
                {field('calDate', 'Date')}
                {field('calDueDate', 'Due Date')}
                <SignatureField label="Customer Signature" onChange={setCustomerSig} />
                <SignatureField label="Calibrator Signature" onChange={setCalibratorSig} />
                <p style={{ fontSize: '0.78em', color: '#888' }}>
                  Per-head Before/After weights come from the Span Adjust table.
                </p>
              </div>
              <div style={{ flex: '2 1 420px', minWidth: '320px' }}>
                {pdfUrl ? (
                  <iframe
                    title="Span Calibration preview"
                    src={pdfUrl}
                    style={{ width: '100%', height: '74vh', border: '1px solid #ccc', borderRadius: '4px' }}
                  />
                ) : (
                  <div style={{ padding: '20px' }}>Generating preview…</div>
                )}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
            <button className="btn btn-success" onClick={handleDownload}>Download PDF</button>
          </div>
        </div>
      </div>
    </div>
  );
}
