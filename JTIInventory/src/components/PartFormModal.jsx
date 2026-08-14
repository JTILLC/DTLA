import { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import PhotoField from './PhotoField';
import CustomerPicker from './CustomerPicker';
import useScrollLock from '../utils/useScrollLock';

const NEW_CATEGORY_SENTINEL = '__new__';

export default function PartFormModal({
  open, onClose, onSave, initial,
  categories, onCreateCategory,
  customers, onCreateCustomer,
  uploadPath, onOpenPhoto, onError,
}) {
  const [form, setForm] = useState(() => defaults(initial));
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(defaults(initial));
      setNewCategory('');
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
      let category = form.category;
      if (category === NEW_CATEGORY_SENTINEL) {
        const name = newCategory.trim();
        if (!name) { setSaving(false); return; }
        await onCreateCategory(name);
        category = name;
      }
      await onSave({
        ...form,
        category,
        qty: Number(form.qty) || 0,
        minQty: Number(form.minQty) || 0,
        cost: form.cost === '' ? null : Number(form.cost),
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
              <h5 className="modal-title">{initial?.id ? 'Edit part' : 'Add part'}</h5>
              <button type="button" className="btn-close" onClick={onClose} aria-label="Close"></button>
            </div>
            <div className="modal-body">
              <div className="mb-3">
                <label className="form-label">Name *</label>
                <input className="form-control" value={form.name} onChange={e => set('name', e.target.value)} required autoFocus />
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label">SKU / Part #</label>
                  <input className="form-control" value={form.sku} onChange={e => set('sku', e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="form-label">Location</label>
                  <input className="form-control" value={form.location} onChange={e => set('location', e.target.value)} />
                </div>
              </div>
              <div className="row g-2 mb-3">
                <div className="col-6">
                  <label className="form-label">Quantity</label>
                  <input type="number" min="0" className="form-control" value={form.qty} onChange={e => set('qty', e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="form-label">Min stock</label>
                  <input type="number" min="0" className="form-control" value={form.minQty} onChange={e => set('minQty', e.target.value)} />
                </div>
              </div>
              <div className="mb-3">
                <label className="form-label">Category</label>
                <select className="form-select" value={form.category} onChange={e => set('category', e.target.value)}>
                  <option value="">Uncategorized</option>
                  {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  <option value={NEW_CATEGORY_SENTINEL}>+ Create new category…</option>
                </select>
                {form.category === NEW_CATEGORY_SENTINEL && (
                  <input
                    className="form-control mt-2"
                    placeholder="New category name"
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    autoFocus
                    required
                  />
                )}
              </div>
              <div className="mb-3">
                <label className="form-label">Cost ($)</label>
                <input type="number" step="0.01" min="0" className="form-control" value={form.cost} onChange={e => set('cost', e.target.value)} />
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
    sku: initial?.sku || '',
    category: initial?.category || '',
    customers: Array.isArray(initial?.customers) ? initial.customers : [],
    location: initial?.location || '',
    qty: initial?.qty ?? 0,
    minQty: initial?.minQty ?? 0,
    cost: initial?.cost ?? '',
    notes: initial?.notes || '',
    photoUrl: initial?.photoUrl || null,
    photoPath: initial?.photoPath || null,
  };
}
