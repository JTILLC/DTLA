// src/components/CrewPage.jsx
//
// Who is working, and on which line.
//
// Two jobs on one screen because they are the same job at two cadences: the
// ROSTER changes when someone is hired or leaves, the LINE DESIGNATION changes
// every shift. Splitting them across two screens would mean a supervisor
// crewing up in the morning has to visit both.
//
// The plant maintains both. People are hired and moved by the plant, not by
// JTI, and routing that through a support request guarantees the list goes
// stale — which is worse than no list, because entries then get logged against
// whoever is nearest on the dropdown. Scoping is enforced by the Firestore
// rules: a plant login writes under its own customer and nowhere else.
//
// Designations are shared, not per-device: a supervisor setting the shift once
// should reach every tablet on the floor. Names are copied onto entries as they
// are saved, so re-crewing a line never rewrites what was already logged.
import { useEffect, useMemo, useState } from 'react';
import { Users, Plus, Trash2, Check, AlertTriangle, Save, KeyRound, ShieldCheck } from 'lucide-react';
import {
  subscribeCrew, saveCrew, subscribeLineCrew, saveLineCrew,
} from '../services/logs.js';
import { crewAge } from '../utils/useLineCrew.js';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';
import PinPrompt from './PinPrompt.jsx';
import { hashPin, hasPin, pinProblem } from '../utils/pin.js';

const ROLES = [
  { key: 'operator', label: 'Operator' },
  { key: 'tech', label: 'Maintenance' },
  { key: 'supervisor', label: 'Supervisor' },
];

const newId = () => `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export default function CrewPage({ workspaceId, customerId, customerName, visits = [], isJti = false }) {
  const toast = useToast();
  const dialog = useDialog();
  // A JTI login is already an admin by its Firebase claim, so it never needs a
  // plant PIN. A plant admin proves themselves once per visit to this page.
  const [adminOk, setAdminOk] = useState(isJti);
  const [askAdmin, setAskAdmin] = useState(null);   // () => void, run once verified
  const [pinFor, setPinFor] = useState(null);       // person having a PIN set
  const [people, setPeople] = useState([]);
  const [lineCrew, setLineCrew] = useState({ lines: {} });
  const [draftLines, setDraftLines] = useState(null);   // null = in sync with saved
  const [editingRoster, setEditingRoster] = useState(false);
  const [draftPeople, setDraftPeople] = useState([]);
  const [saving, setSaving] = useState(false);
  const [savingRoster, setSavingRoster] = useState(false);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeCrew(workspaceId, customerId, setPeople);
  }, [workspaceId, customerId]);

  useEffect(() => { setAdminOk(isJti); }, [isJti, customerId]);

  // Gate an admin action: JTI passes straight through, a plant admin is asked
  // for their PIN once and then trusted for the rest of this page visit.
  const asAdmin = (run) => {
    if (adminOk) return run();
    setAskAdmin(() => run);
  };

  // The very first admin cannot prove themselves — nobody has a PIN yet. JTI
  // sets that one, which is why the flag is meaningless without a JTI login to
  // bootstrap it.
  const anyPlantAdmin = people.some((p) => p.admin && hasPin(p));

  const setPersonPin = async (person, pin) => {
    const problem = pinProblem(pin);
    if (problem) { toast.error(problem); return false; }
    const pinHash = await hashPin(customerId, person.id, pin);
    const next = people.map((p) => (
      p.id === person.id ? { ...p, pinHash, pinSetAt: new Date().toISOString() } : p
    ));
    await saveCrew(workspaceId, customerId, next);
    toast.success(`PIN set for ${person.name}`);
    return true;
  };

  const clearPersonPin = async (person) => {
    const ok = await dialog.confirm(
      `Clear ${person.name}'s PIN? They won't be able to identify themselves until a new one is set.`,
      { title: 'Clear PIN', confirmText: 'Clear', variant: 'danger' }
    );
    if (!ok) return;
    const next = people.map((p) => {
      if (p.id !== person.id) return p;
      const { pinHash, pinSetAt, ...rest } = p;   // eslint-disable-line no-unused-vars
      return rest;
    });
    await saveCrew(workspaceId, customerId, next);
    toast.success(`PIN cleared for ${person.name}`);
  };

  const toggleAdmin = async (person) => {
    const next = people.map((p) => (p.id === person.id ? { ...p, admin: !p.admin } : p));
    await saveCrew(workspaceId, customerId, next);
    toast.success(`${person.name} is ${!person.admin ? 'now' : 'no longer'} a plant admin`);
  };

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeLineCrew(workspaceId, customerId, (d) => {
      setLineCrew(d);
      setDraftLines(null);            // remote wins until the user edits again
    });
  }, [workspaceId, customerId]);

  // Lines come from the customer's visits — the only place a line is defined.
  const lines = useMemo(() => {
    const seen = new Set();
    [...visits]
      .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
      .forEach((v) => (v.lines || []).forEach((l) => { if (l?.title) seen.add(l.title); }));
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [visits]);

  const current = draftLines ?? (lineCrew.lines || {});
  const dirty = draftLines !== null;
  const age = crewAge(lineCrew.updatedAt);

  const setLine = (title, role, name) =>
    setDraftLines({
      ...current,
      [title]: { ...(current[title] || {}), [role]: name },
    });

  const clearLine = (title) => {
    const next = { ...current };
    delete next[title];
    setDraftLines(next);
  };

  const forRole = (role) => people.filter((p) => (p.roles || []).includes(role));

  const commitLines = async () => {
    setSaving(true);
    try {
      await saveLineCrew(workspaceId, customerId, current);
      setDraftLines(null);
      toast.success('Line crewing saved');
    } catch (err) {
      console.error('Save line crew failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const commitRoster = async () => {
    setSavingRoster(true);
    try {
      await saveCrew(workspaceId, customerId, draftPeople);
      setEditingRoster(false);
      toast.success('Crew list saved');
    } catch (err) {
      console.error('Save crew failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSavingRoster(false);
    }
  };

  if (!customerId) {
    return <div className="text-muted p-3">Select a customer to set up crewing.</div>;
  }

  const anyAssigned = Object.keys(current).length > 0;

  return (
    <div>
      <h5 className="d-flex align-items-center gap-2 mb-3">
        <Users size={18} /> Crew{customerName ? ` — ${customerName}` : ''}
      </h5>

      <div className="card mb-3">
        <div className="card-header d-flex justify-content-between align-items-center flex-wrap gap-2">
          <strong>On shift by line</strong>
          <div className="d-flex align-items-center gap-2">
            {lineCrew.updatedAt && (
              <span className={'small ' + (age.stale ? 'text-warning-emphasis' : 'text-muted')}>
                {age.stale && <AlertTriangle size={12} />} {age.label}
              </span>
            )}
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={commitLines}
              disabled={!dirty || saving}
            >
              <Save size={14} /> {saving ? 'Saving…' : 'Save crewing'}
            </button>
          </div>
        </div>
        <div className="card-body">
          {age.stale && (
            <div className="alert alert-warning py-2">
              This crewing was {age.label}. Check it still matches who is actually
              on before logging work against it.
            </div>
          )}

          {lines.length === 0 ? (
            <div className="text-muted">No lines found for this customer yet.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Line</th>
                    {ROLES.map((r) => <th key={r.key}>{r.label}</th>)}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((title) => {
                    const c = current[title] || {};
                    return (
                      <tr key={title}>
                        <td data-label="Line"><strong>{title}</strong></td>
                        {ROLES.map((r) => {
                          const options = forRole(r.key);
                          const value = c[r.key] || '';
                          return (
                            <td key={r.key} data-label={r.label}>
                              <select
                                className="form-select form-select-sm"
                                value={value}
                                onChange={(e) => setLine(title, r.key, e.target.value)}
                                aria-label={`${r.label} on ${title}`}
                              >
                                <option value="">—</option>
                                {/* Someone since removed from the roster still
                                    shows, so a saved designation never silently
                                    blanks. */}
                                {value && !options.some((p) => p.name === value) && (
                                  <option value={value}>{value} (not on list)</option>
                                )}
                                {options.map((p) => (
                                  <option key={p.id} value={p.name}>{p.name}</option>
                                ))}
                              </select>
                            </td>
                          );
                        })}
                        <td>
                          {(c.operator || c.tech || c.supervisor) && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => clearLine(title)}
                            >
                              Clear
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {people.length === 0 && lines.length > 0 && (
            <div className="form-text mt-2">
              Add people to the crew list below before you can assign them.
            </div>
          )}
          {!anyAssigned && people.length > 0 && (
            <div className="form-text mt-2">
              Nothing crewed yet — entries logged now will record no names.
            </div>
          )}
          {dirty && (
            <div className="form-text mt-2">Unsaved changes — press Save crewing.</div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header d-flex justify-content-between align-items-center">
          <strong>Crew list</strong>
          {!editingRoster && (
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => { setDraftPeople(people.map((p) => ({ ...p }))); setEditingRoster(true); }}
            >
              Edit
            </button>
          )}
        </div>
        <div className="card-body">
          {!editingRoster ? (
            people.length === 0 ? (
              <div className="text-muted">
                No one on the list yet — press Edit to add the people who work here.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead>
                    <tr><th>Name</th><th>Roles</th><th>PIN</th><th>Admin</th><th /></tr>
                  </thead>
                  <tbody>
                    {people.map((p) => (
                      <tr key={p.id}>
                        <td data-label="Name"><strong>{p.name}</strong></td>
                        <td data-label="Roles" className="small text-muted">
                          {(p.roles || []).map((r) => ROLES.find((x) => x.key === r)?.label).filter(Boolean).join(', ')}
                        </td>
                        <td data-label="PIN">
                          {hasPin(p)
                            ? <span className="badge bg-success">set</span>
                            : <span className="badge bg-secondary">none</span>}
                        </td>
                        <td data-label="Admin">
                          {p.admin
                            ? <span className="badge bg-primary"><ShieldCheck size={11} /> admin</span>
                            : <span className="text-muted small">—</span>}
                        </td>
                        <td className="text-end">
                          <div className="d-flex gap-1 justify-content-end flex-wrap">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => asAdmin(() => setPinFor(p))}
                            >
                              <KeyRound size={13} /> {hasPin(p) ? 'Reset PIN' : 'Set PIN'}
                            </button>
                            {hasPin(p) && (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-danger"
                                onClick={() => asAdmin(() => clearPersonPin(p))}
                              >
                                Clear
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              onClick={() => asAdmin(() => toggleAdmin(p))}
                            >
                              {p.admin ? 'Remove admin' : 'Make admin'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!anyPlantAdmin && (
                  <div className="form-text mt-2">
                    No plant admin with a PIN yet — JTI sets the first one, then
                    that person can manage the rest.
                  </div>
                )}
              </div>
            )
          ) : (
            <>
              <div className="small text-muted mb-2">
                Tick every role a person can fill — the tech on nights is often
                the supervisor too.
              </div>
              {draftPeople.map((p, i) => (
                <div key={p.id} className="d-flex flex-wrap align-items-center gap-2 mb-2">
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    style={{ maxWidth: '200px' }}
                    placeholder="Name"
                    value={p.name}
                    onChange={(e) => setDraftPeople((d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  {ROLES.map((r) => (
                    <div className="form-check form-check-inline" key={r.key}>
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id={`${p.id}-${r.key}`}
                        checked={(p.roles || []).includes(r.key)}
                        onChange={(e) => setDraftPeople((d) => d.map((x, j) => {
                          if (j !== i) return x;
                          const roles = new Set(x.roles || []);
                          if (e.target.checked) roles.add(r.key); else roles.delete(r.key);
                          return { ...x, roles: [...roles] };
                        }))}
                      />
                      <label className="form-check-label small" htmlFor={`${p.id}-${r.key}`}>
                        {r.label}
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-danger ms-auto"
                    onClick={() => setDraftPeople((d) => d.filter((_, j) => j !== i))}
                    aria-label={`Remove ${p.name || 'person'}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <div className="d-flex gap-2 flex-wrap">
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setDraftPeople((d) => [...d, { id: newId(), name: '', roles: ['operator'] }])}
                >
                  <Plus size={14} /> Add person
                </button>
                <button type="button" className="btn btn-sm btn-primary" onClick={commitRoster} disabled={savingRoster}>
                  <Check size={14} /> {savingRoster ? 'Saving…' : 'Save crew list'}
                </button>
                <button type="button" className="btn btn-sm btn-link" onClick={() => setEditingRoster(false)}>
                  Cancel
                </button>
              </div>
              <div className="form-text">
                Removing someone here never changes entries they already signed —
                a log has to keep saying what it said on the day.
              </div>
            </>
          )}
        </div>
      </div>

      {askAdmin && (
        <PinPrompt
          customerId={customerId}
          people={people}
          requireAdmin
          title="Supervisor PIN"
          message="Setting or clearing someone's PIN needs an admin."
          onVerified={() => {
            const run = askAdmin;
            setAskAdmin(null);
            setAdminOk(true);
            run();
          }}
          onCancel={() => setAskAdmin(null)}
        />
      )}

      {pinFor && (
        <SetPinDialog
          person={pinFor}
          onCancel={() => setPinFor(null)}
          onSave={async (pin) => {
            const ok = await setPersonPin(pinFor, pin);
            if (ok) setPinFor(null);
          }}
        />
      )}
    </div>
  );
}

// Chosen by the supervisor with the person present, rather than generated: a
// PIN someone picks is a PIN they remember, and the failure mode of a forgotten
// one is another trip to a supervisor.
function SetPinDialog({ person, onSave, onCancel }) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (pin !== again) return setError('The two PINs do not match');
    const problem = pinProblem(pin);
    if (problem) return setError(problem);
    onSave(pin);
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3400, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px',
      }}
    >
      <form className="card shadow" style={{ width: '100%', maxWidth: '420px' }} onSubmit={submit}>
        <div className="card-header"><strong>PIN for {person.name}</strong></div>
        <div className="card-body d-flex flex-column gap-2">
          <div className="small text-muted">
            4 to 6 digits. Have {person.name} type it themselves — it identifies
            their work.
          </div>
          <input
            type="password" inputMode="numeric" autoComplete="off" className="form-control"
            placeholder="New PIN" value={pin}
            onChange={(e) => { setPin(e.target.value); setError(''); }}
          />
          <input
            type="password" inputMode="numeric" autoComplete="off" className="form-control"
            placeholder="Again" value={again}
            onChange={(e) => { setAgain(e.target.value); setError(''); }}
          />
          {error && <div className="small text-danger">{error}</div>}
          <div className="d-flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm">Save PIN</button>
            <button type="button" className="btn btn-link btn-sm" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </form>
    </div>
  );
}
