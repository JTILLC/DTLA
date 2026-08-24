import { useState, useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from './firebase';
import { saveValidation } from './cloud';
import HistoryModal from './HistoryModal';
import PdfPreview from './PdfPreview';
import JobBar from './JobBar';

// Generic shell shared by every validation form. `def` (from defs.js) supplies the
// form-specific model, fields component, PDF builder, storage key and cloud collection.
export default function FormShell({ user, def, onHome }) {
  const [data, setData] = useState(() => {
    try {
      const saved = localStorage.getItem(def.storageKey);
      if (saved) return { ...def.initialData(), ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return def.initialData();
  });
  const [pdfBytes, setPdfBytes] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  const [view, setView] = useState('form');

  useEffect(() => {
    try { localStorage.setItem(def.storageKey, JSON.stringify(data)); } catch { /* ignore */ }
  }, [data, def.storageKey]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const doc = def.buildPdf(data);
        setPdfBytes(new Uint8Array(doc.output('arraybuffer')));
      } catch (err) { console.error('PDF build failed:', err); }
    }, 400);
    return () => clearTimeout(t);
  }, [data, def]);

  const download = () => {
    const doc = def.buildPdf(data);
    doc.save(`${def.fileName(data).replace(/[^a-z0-9-]/gi, '-')}.pdf`);
  };
  const newForm = (keepCustomer) => {
    const blank = def.initialData();
    if (keepCustomer) {
      const carried = {};
      // customerId travels with the customer info; the SR number does not —
      // a new form is a new job until somebody says which.
      [...def.customerFields, 'customerId'].forEach((k) => { carried[k] = data[k]; });
      setData({ ...blank, ...carried });
    } else {
      setData(blank);
    }
    setShowNewDialog(false);
  };
  const saveCloud = async () => {
    setSaveStatus('Saving…');
    try {
      const id = await saveValidation(def.collection, user.uid, data);
      setData((d) => ({ ...d, cloudId: id }));
      setSaveStatus('Saved ✓');
      setTimeout(() => setSaveStatus(''), 2500);
    } catch (e) {
      console.error(e);
      setSaveStatus('Save failed');
    }
  };
  const loadFromCloud = (v) => { setData({ ...def.initialData(), ...v }); setShowHistory(false); };

  const Fields = def.Fields;

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">{def.title}</div>
        <div className="viewtoggle" role="tablist">
          <button className={view === 'form' ? 'on' : ''} onClick={() => setView('form')}>Form</button>
          <button className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>PDF</button>
        </div>
        <div className="actions">
          {saveStatus && <span className="savestatus">{saveStatus}</span>}
          <button className="btn ghost" onClick={onHome}>☰ Forms</button>
          <button className="btn ghost" onClick={() => setShowNewDialog(true)}>New</button>
          <button className="btn ghost" onClick={() => setShowHistory(true)}>Open</button>
          <button className="btn ghost" onClick={saveCloud}>Save to Cloud</button>
          <button className="btn primary" onClick={download}>Download PDF</button>
          <button className="btn ghost" onClick={() => signOut(auth)} title={user.email}>Logout</button>
        </div>
      </header>

      <div className={`layout view-${view}`}>
        <div className="formpane">
          <JobBar user={user} def={def} data={data} setData={setData} />
          <Fields data={data} setData={setData} />
        </div>
        <div className="previewpane">
          {pdfBytes ? <PdfPreview bytes={pdfBytes} /> : <div className="loading">Generating preview…</div>}
        </div>
      </div>

      {showNewDialog && (
        <div className="modal" onClick={() => setShowNewDialog(false)}>
          <div className="modalcard sm" onClick={(e) => e.stopPropagation()}>
            <div className="modalhead"><h3>New Validation</h3><button className="x" onClick={() => setShowNewDialog(false)}>×</button></div>
            <p className="muted">Start a new form — keep the current Customer Information?</p>
            <div className="newbtns">
              <button className="btn primary" onClick={() => newForm(true)}>Keep Customer Info</button>
              <button className="btn neutral" onClick={() => newForm(false)}>Blank Form</button>
            </div>
          </div>
        </div>
      )}
      {showHistory && (
        <HistoryModal
          collection={def.collection}
          uid={user.uid}
          summary={def.summary}
          onClose={() => setShowHistory(false)}
          onLoad={loadFromCloud}
        />
      )}
    </div>
  );
}
