// src/components/PinPrompt.jsx
//
// "Who are you?" — pick a name, enter that person's PIN.
//
// Used two ways: to identify whoever is about to take a head offline, and to
// authorise a plant admin before they hand out or reset someone else's PIN.
//
// `requireAdmin` narrows the list to people flagged as plant admins, so the
// dialog cannot be used to authorise an action as someone who lacks the right —
// the check is on the list AND on the caller, never on the list alone.
//
// People without a PIN are shown greyed rather than hidden. "My name isn't
// there" sends someone to find a supervisor; "my name is there but greyed"
// tells them exactly what is missing.
import { useEffect, useRef, useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { verifyPin, hasPin } from '../utils/pin.js';

export default function PinPrompt({
  customerId,
  people = [],
  requireAdmin = false,
  title,
  message,
  onVerified,          // (person) => void
  onCancel,
}) {
  const [selected, setSelected] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pinRef = useRef(null);

  const eligible = people.filter((p) => (requireAdmin ? p.admin : true));

  useEffect(() => {
    if (selected && pinRef.current) pinRef.current.focus();
  }, [selected]);

  const submit = async (e) => {
    e?.preventDefault?.();
    const person = eligible.find((p) => p.id === selected);
    if (!person) return setError('Pick your name first');
    if (!hasPin(person)) return setError(`${person.name} has no PIN yet — a supervisor can set one.`);
    setBusy(true);
    try {
      const ok = await verifyPin(customerId, person, pin);
      if (!ok) {
        setPin('');
        return setError('That PIN is not right');
      }
      onVerified(person);
    } catch (err) {
      console.error('PIN check failed:', err);
      setError('Could not check that PIN');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3400, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px',
      }}
    >
      <form className="card shadow" style={{ width: '100%', maxWidth: '420px' }} onSubmit={submit}>
        <div className="card-header d-flex justify-content-between align-items-center">
          <strong className="d-flex align-items-center gap-2">
            <KeyRound size={16} /> {title || 'Who are you?'}
          </strong>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onCancel} aria-label="Cancel">
            <X size={14} />
          </button>
        </div>
        <div className="card-body d-flex flex-column gap-2">
          {message && <div className="small text-muted">{message}</div>}

          {eligible.length === 0 ? (
            <div className="alert alert-warning py-2 mb-0">
              {requireAdmin
                ? 'Nobody at this plant is set up as an admin yet. JTI can set the first one.'
                : 'No one is on the crew list yet.'}
            </div>
          ) : (
            <>
              <select
                className="form-select"
                value={selected}
                onChange={(e) => { setSelected(e.target.value); setError(''); }}
                aria-label="Your name"
              >
                <option value="">Your name…</option>
                {eligible.map((p) => (
                  <option key={p.id} value={p.id} disabled={!hasPin(p)}>
                    {p.name}{hasPin(p) ? '' : ' (no PIN set)'}
                  </option>
                ))}
              </select>

              <input
                ref={pinRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className="form-control"
                placeholder="PIN"
                value={pin}
                onChange={(e) => { setPin(e.target.value); setError(''); }}
              />

              {error && <div className="small text-danger">{error}</div>}

              <button type="submit" className="btn btn-primary" disabled={busy || !selected || !pin}>
                {busy ? 'Checking…' : 'Confirm'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
