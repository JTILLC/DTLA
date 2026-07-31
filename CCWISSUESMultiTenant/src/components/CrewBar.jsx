// src/components/CrewBar.jsx
//
// "Who's working" — set once at the start of a shift, stamped on everything
// logged afterwards.
//
// The plant tablet is signed in as one shared account, so without this every
// entry reads as the same anonymous login. Three dropdowns and a roster turn
// that into a name.
//
// Set once, not per entry. Asking an operator to re-pick themselves on every
// board swap is how you end up with the field left blank or wrong; the shift
// changes far less often than the log does.
//
// Nothing is enforced. This says who was on, not who can prove they were on —
// if an entry ever needs to be an attestation, that wants a signature or a PIN,
// not a dropdown.
//
// The plant maintains its own roster. People are hired, moved between shifts and
// let go by the plant, not by JTI, and routing every new starter through a
// support request guarantees the list goes stale and entries get logged against
// whoever is nearest on the dropdown. JTI keeps access too, since it edits the
// same document.
//
// Scoping is enforced where it belongs: the roster lives under
// user_files/{workspaceId}/customers/{customerId}/config/crew, and the Firestore
// rules already confine a plant login to its own customer — so "manage your own
// roster" cannot become "manage someone else's".
import { useEffect, useState } from 'react';
import { Users, Plus, Trash2, Check } from 'lucide-react';
import { subscribeCrew, saveCrew } from '../services/logs.js';
import { useShiftCrew } from '../utils/useShiftCrew.js';
import { useToast } from './Toast.jsx';

const ROLES = [
  { key: 'operator', label: 'Operator' },
  { key: 'tech', label: 'Maintenance' },
  { key: 'supervisor', label: 'Supervisor' },
];

const newId = () => `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

export default function CrewBar({ workspaceId, customerId, canEditRoster = true }) {
  const toast = useToast();
  const { crew, setRole, clear } = useShiftCrew(customerId);
  const [people, setPeople] = useState([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeCrew(workspaceId, customerId, setPeople);
  }, [workspaceId, customerId]);

  const forRole = (role) => people.filter((p) => (p.roles || []).includes(role));

  const commit = async () => {
    setSaving(true);
    try {
      await saveCrew(workspaceId, customerId, draft);
      setEditing(false);
      toast.success('Crew list saved');
    } catch (err) {
      console.error('Save crew failed:', err);
      toast.error('Could not save: ' + (err?.message || 'unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (!customerId) return null;

  const nobodySet = !crew.operator && !crew.tech && !crew.supervisor;

  return (
    <div className="card mb-3">
      <div className="card-body py-2">
        <div className="d-flex flex-wrap align-items-center gap-2">
          <span className="d-flex align-items-center gap-1 small text-muted">
            <Users size={14} /> On shift
          </span>

          {ROLES.map((r) => {
            const options = forRole(r.key);
            return (
              <div key={r.key} className="d-flex align-items-center gap-1">
                <label className="small text-muted mb-0" htmlFor={`crew-${r.key}`}>{r.label}</label>
                <select
                  id={`crew-${r.key}`}
                  className="form-select form-select-sm"
                  style={{ width: 'auto', minWidth: '130px' }}
                  value={crew[r.key] || ''}
                  onChange={(e) => setRole(r.key, e.target.value)}
                >
                  <option value="">—</option>
                  {/* A name saved earlier that has since left the roster still
                      shows, so the bar never silently blanks someone's shift. */}
                  {crew[r.key] && !options.some((p) => p.name === crew[r.key]) && (
                    <option value={crew[r.key]}>{crew[r.key]} (not on list)</option>
                  )}
                  {options.map((p) => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                </select>
              </div>
            );
          })}

          <div className="ms-auto d-flex align-items-center gap-2">
            {!nobodySet && (
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clear}>
                Clear
              </button>
            )}
            {canEditRoster && !editing && (
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => { setDraft(people.map((p) => ({ ...p }))); setEditing(true); }}
              >
                Edit crew list
              </button>
            )}
          </div>
        </div>

        {nobodySet && people.length > 0 && (
          <div className="form-text mt-1">
            Set who&apos;s on shift — every entry logged from this device will record them.
          </div>
        )}
        {people.length === 0 && (
          <div className="form-text mt-1">
            {canEditRoster
              ? 'No crew list yet — add the people who work here.'
              : 'No crew list has been set up for this plant yet.'}
          </div>
        )}

        {editing && (
          <div className="border-top mt-2 pt-2">
            <div className="small text-muted mb-2">
              Tick every role a person can fill — the tech on nights is often the
              supervisor too.
            </div>
            {draft.map((p, i) => (
              <div key={p.id} className="d-flex flex-wrap align-items-center gap-2 mb-2">
                <input
                  type="text"
                  className="form-control form-control-sm"
                  style={{ maxWidth: '200px' }}
                  placeholder="Name"
                  value={p.name}
                  onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                {ROLES.map((r) => (
                  <div className="form-check form-check-inline" key={r.key}>
                    <input
                      className="form-check-input"
                      type="checkbox"
                      id={`${p.id}-${r.key}`}
                      checked={(p.roles || []).includes(r.key)}
                      onChange={(e) => setDraft((d) => d.map((x, j) => {
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
                  onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                  aria-label={`Remove ${p.name || 'person'}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div className="d-flex gap-2">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setDraft((d) => [...d, { id: newId(), name: '', roles: ['operator'] }])}
              >
                <Plus size={14} /> Add person
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={commit} disabled={saving}>
                <Check size={14} /> {saving ? 'Saving…' : 'Save crew list'}
              </button>
              <button type="button" className="btn btn-sm btn-link" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
            <div className="form-text">
              Removing someone here never changes entries they already signed —
              a log has to keep saying what it said on the day.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
