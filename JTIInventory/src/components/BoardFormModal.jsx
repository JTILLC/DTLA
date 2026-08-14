import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import PhotoField from './PhotoField';
import CustomerPicker from './CustomerPicker';
import useScrollLock from '../utils/useScrollLock';

export const BOARD_STATUSES = [
  { key: 'new',       label: 'New' },
  { key: 'used',      label: 'Used' },
  { key: 'repaired',  label: 'Repaired' },
  { key: 'dead',      label: 'Dead' },
  { key: 'testing',   label: 'Testing' },
];

export default function BoardFormModal({
  open, onClose, onSave, initial,
  customers, onCreateCustomer,
  uploadPath, onOpenPhoto, onError,
}) {
  const [form, setForm] = useState(() => defaults(initial));
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(defaults(initial));
      setSaving(false);
      setPhotoUploading(false);
    }
  }, [open, initial]);

  useScrollLock(open);

  if (!open) return null;

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...form,
        qty: Number(form.qty) || 0,
      });
      onClose();
    } catch (err) {
      console.error(err);
      setSaving(false);
    }
  };

  return (
    <div className="modal show d-block" tabIndex="-1" style={{ background: 'rgba(15,23,42,0.55)' }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-scrollable modal-dialog-centered" onClick={e => e.stopPropagation()}>
        <div className="modal-content">
          <form onSubmit={handleSubmit}>
            <div className="modal-header">
              <h5 className="modal-title">{initial?.id ? 'Edit board' : 'Add board'}</h5>
              <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
            </div>
            <div className="modal-body">
              <div className="mb-3">
                <label className="form-label">Name *</label>
                <input className="form-control" value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label">Model</label>
                  <input className="form-control" value={form.model} onChange={e => set('model', e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="form-label">Revision</label>
                  <input className="form-control" value={form.revision} onChange={e => set('revision', e.target.value)} />
                </div>
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label">Serial / ID</label>
                  <input className="form-control" value={form.serial} onChange={e => set('serial', e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="form-label">Quantity</label>
                  <input type="number" min="0" className="form-control" value={form.qty} onChange={e => set('qty', e.target.value)} />
                </div>
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.status} onChange={e => set('status', e.target.value)}>
                    {BOARD_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div className="col-6">
                  <label className="form-label">Location</label>
                  <input className="form-control" value={form.location} onChange={e => set('location', e.target.value)} />
                </div>
              </div>
              <div className="mb-3">
                <label className="form-label">Customers</label>
                <CustomerPicker
                  selected={form.customers}
                  onChange={(arr) => setForm(prev => ({ ...prev, customers: arr }))}
                  customers={customers || []}
                  onCreate={onCreateCustomer}
                />
              </div>
              <div className="mb-3">
                <label className="form-label">Photo</label>
                <PhotoField
                  value={{ photoUrl: form.photoUrl, photoPath: form.photoPath }}
                  onChange={({ photoUrl, photoPath }) => {
                    setForm(prev => ({ ...prev, photoUrl, photoPath }));
                  }}
                  uploadPath={uploadPath}
                  onOpen={onOpenPhoto}
                  onError={onError}
                  onUploadingChange={setPhotoUploading}
                />
              </div>
              <div className="mb-1">
                <label className="form-label">Notes</label>
                <textarea className="form-control" rows="3" value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving || photoUploading}>
                <Save size={16} style={{ marginRight: 4 }} />
                {photoUploading ? 'Photo uploading…' : (saving ? 'Saving…' : 'Save')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function defaults(initial) {
  return {
    id: initial?.id || null,
    name: initial?.name || '',
    model: initial?.model || '',
    revision: initial?.revision || '',
    serial: initial?.serial || '',
    status: initial?.status || 'new',
    location: initial?.location || '',
    qty: initial?.qty ?? 1,
    notes: initial?.notes || '',
    customers: Array.isArray(initial?.customers) ? initial.customers : [],
    photoUrl: initial?.photoUrl || null,
    photoPath: initial?.photoPath || null,
  };
}
