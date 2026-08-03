// shared/components/TemplateBar.jsx
//
// JTI's own standard, and the button that sends it to plants.
//
// Before this, a checklist or board list existed only inside one customer, and
// the only way to reuse it was CopyConfigFrom — pull one plant's setup into
// another's editor, one plant at a time. That makes whichever customer JTI last
// tidied the de-facto master, which is a fragile place for a standard to live.
//
// Two additions, both deliberately manual:
//
//   MASTER   a named template in jti_templates, belonging to JTI rather than to
//            any plant. Load it into the editor, or save the editor over it.
//
//   PUSH     copy what is in the editor into chosen customers' own config.
//
// Push COPIES. It does not subscribe a plant to a master. A plant that adds an
// item to their checklist must not have it disappear because JTI edited the
// standard, and editing the standard must not silently change what fifty plants
// check tomorrow morning. So pushing is an act with a date on it, and the push
// dialog says plainly which plants already have something and will be replaced.
//
// Whatever a push replaces is copied to configBackups first (see
// pushConfigToCustomers) — a fan-out across a dozen plants is exactly the action
// that destroys the one checklist somebody spent an afternoon tailoring.
import { useEffect, useMemo, useState } from 'react';
import { BookMarked, Save, Send, Trash2, X } from 'lucide-react';
import {
  subscribeTemplates, saveTemplate, deleteTemplate,
  pushConfigToCustomers, fetchConfigSummaries,
} from '../services/logs.js';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';
import { useBodyScrollLock } from '../utils/useBodyScrollLock.js';

export default function TemplateBar({
  workspaceId,
  customers = [],
  currentCustomerId,
  configKey,          // 'pmTemplate' | 'boardTypes'
  label,              // 'checklist' | 'board types'
  draft,              // () => data object as it would be saved, e.g. { sections }
  describe,           // (data) => string | null
  onLoad,             // (data) => void — load a master into the caller's editor
  updatedBy,
}) {
  const toast = useToast();
  const dialog = useDialog();
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState('');
  const [showPush, setShowPush] = useState(false);

  useEffect(() => subscribeTemplates(configKey, setTemplates), [configKey]);

  const current = templates.find((t) => t.id === selected) || null;

  const loadMaster = async () => {
    if (!current) return toast.error('Pick a template first');
    const summary = describe(current.data) || 'nothing';
    const ok = await dialog.confirm(
      `Load "${current.name}" (${summary}) into the editor? This replaces what is in the ` +
      `editor now. Nothing is saved to this customer until you press save.`,
      { title: 'Load template', confirmText: 'Load into editor' }
    );
    if (!ok) return;
    onLoad(current.data || {});
    toast.success('Loaded — review it, then save.');
  };

  const saveMaster = async () => {
    const data = draft();
    const summary = describe(data);
    if (!summary) return toast.error(`There is no ${label} in the editor to save.`);

    // Updating the selected master, or minting a new one.
    const name = current
      ? await dialog.prompt('Name for this template', {
          title: 'Save as JTI template', defaultValue: current.name, confirmText: 'Save',
        })
      : await dialog.prompt('Name for this template', {
          title: 'Save as JTI template',
          defaultValue: `Standard ${label}`,
          confirmText: 'Save',
        });
    if (name == null || !String(name).trim()) return;

    const overwriting = current && String(name).trim() === current.name;
    try {
      const id = await saveTemplate({
        id: overwriting ? current.id : null,
        kind: configKey,
        name,
        data,
        updatedBy,
      });
      setSelected(id);
      toast.success(overwriting ? `Updated "${name}"` : `Saved "${name}" as a JTI template`);
    } catch (err) {
      console.error('Save template failed:', err);
      toast.error('Could not save the template: ' + (err?.message || 'unknown error'));
    }
  };

  const removeMaster = async () => {
    if (!current) return;
    const ok = await dialog.confirm(
      `Delete the JTI template "${current.name}"? Plants that already had it pushed keep their copy.`,
      { title: 'Delete template', variant: 'danger', confirmText: 'Delete' }
    );
    if (!ok) return;
    await deleteTemplate(current.id);
    setSelected('');
    toast.success('Template deleted');
  };

  return (
    <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
      <label className="small text-muted mb-0" htmlFor={`tpl-${configKey}`}>
        <BookMarked size={14} className="me-1" />JTI template
      </label>
      <select
        id={`tpl-${configKey}`}
        className="form-select form-select-sm"
        style={{ width: 'auto', maxWidth: '240px' }}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">{templates.length ? 'Choose a template…' : 'No templates saved yet'}</option>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={loadMaster} disabled={!current}>
        Load
      </button>
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={saveMaster}>
        <Save size={14} /> {current ? 'Save over it' : 'Save as template'}
      </button>
      {current && (
        <button type="button" className="btn btn-sm btn-outline-danger" onClick={removeMaster} aria-label="Delete template">
          <Trash2 size={14} />
        </button>
      )}
      <span className="vr d-none d-sm-block" />
      <button type="button" className="btn btn-sm btn-primary" onClick={() => setShowPush(true)}>
        <Send size={14} /> Push to customers…
      </button>

      {showPush && (
        <PushDialog
          workspaceId={workspaceId}
          customers={customers}
          currentCustomerId={currentCustomerId}
          configKey={configKey}
          label={label}
          data={draft()}
          describe={describe}
          templateName={current?.name}
          templateId={current?.id}
          onClose={() => setShowPush(false)}
        />
      )}
      {dialog.DialogComponent}
    </div>
  );
}

// Choosing who gets it, with each plant's current state spelled out. The whole
// point of this screen is that "push to everyone" is a decision made with the
// consequences visible, not a button that reports success afterwards.
function PushDialog({
  workspaceId, customers, currentCustomerId, configKey, label,
  data, describe, templateName, templateId, onClose,
}) {
  const toast = useToast();
  useBodyScrollLock(true);
  const [existing, setExisting] = useState(null); // { [cid]: data|null|undefined }
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const targets = useMemo(
    () => customers.filter((c) => c?.id).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [customers]
  );

  useEffect(() => {
    let off = false;
    fetchConfigSummaries(workspaceId, targets.map((c) => c.id), configKey)
      .then((m) => { if (!off) setExisting(m); })
      .catch(() => { if (!off) setExisting({}); });
    return () => { off = true; };
  }, [workspaceId, configKey, targets]);

  const summary = describe(data);
  const toggle = (id) => setPicked((s) => {
    const next = new Set(s);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const run = async () => {
    if (picked.size === 0) return toast.error('Pick at least one customer');
    setBusy(true);
    try {
      const results = await pushConfigToCustomers(
        workspaceId, [...picked], configKey, data, { templateId, templateName },
      );
      setDone(results);
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) toast.success(`Sent to ${results.length} customer${results.length === 1 ? '' : 's'}`);
      else toast.error(`${failed.length} of ${results.length} failed — see the list`);
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (cid) => targets.find((c) => c.id === cid)?.name || cid;

  return (
    <>
      <div className="modal-backdrop fade show" onClick={onClose} />
      <div className="modal fade show d-block" tabIndex="-1" role="dialog" aria-modal="true">
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">Push {label} to customers</h5>
              <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
            </div>

            <div className="modal-body">
              {done ? (
                <ul className="list-group list-group-flush">
                  {done.map((r) => (
                    <li key={r.customerId} className="list-group-item d-flex justify-content-between align-items-center px-0">
                      <span>{nameOf(r.customerId)}</span>
                      <span className={`badge ${r.ok ? 'bg-success' : 'bg-danger'}`}>
                        {r.ok ? (r.replaced ? 'Replaced' : 'Added') : 'Failed'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <p className="mb-1">
                    Sending <strong>{summary || `an empty ${label}`}</strong>
                    {templateName ? <> from <strong>{templateName}</strong></> : <> from the editor</>}.
                  </p>
                  <p className="small text-secondary">
                    Each customer gets their own copy. Editing it later does not change theirs, and
                    theirs does not change yours. Anything replaced is kept and can be restored.
                  </p>

                  {existing == null ? (
                    <p className="text-secondary">Checking what each customer has…</p>
                  ) : (
                    <ul className="list-group list-group-flush">
                      {targets.map((c) => {
                        const have = existing[c.id];
                        const desc = have ? describe(have) : null;
                        return (
                          <li key={c.id} className="list-group-item px-0">
                            <label className="d-flex align-items-start gap-2 mb-0">
                              <input
                                type="checkbox"
                                className="form-check-input mt-1 flex-shrink-0"
                                checked={picked.has(c.id)}
                                onChange={() => toggle(c.id)}
                              />
                              <span>
                                {c.name || c.id}
                                {c.id === currentCustomerId && <span className="badge bg-secondary ms-2">open now</span>}
                                <br />
                                <small className={desc ? 'text-warning-emphasis' : 'text-secondary'}>
                                  {have === undefined ? 'could not read what they have'
                                    : desc ? `has ${desc} — would be replaced`
                                    : `nothing set up yet`}
                                </small>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div className="modal-footer">
              {done ? (
                <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
              ) : (
                <>
                  <button type="button" className="btn btn-outline-secondary" onClick={onClose}>
                    <X size={16} /> Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={run} disabled={busy || picked.size === 0}>
                    <Send size={16} /> {busy ? 'Sending…' : `Send to ${picked.size || 'no'} customer${picked.size === 1 ? '' : 's'}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
