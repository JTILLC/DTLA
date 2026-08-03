// shared/components/PlantLoginsPage.jsx
//
// A plant managing its own logins.
//
// The tablet on the floor signs in as one shared account, which is fine for
// logging but means "who may add a login?" cannot be answered by the account —
// everyone is that account. So it is answered by the crew roster instead: a
// Site Lead proves themselves with their PIN, exactly as they do to hand one
// out.
//
// Everything real happens in the media Worker, which takes the customer from
// the caller's own token and never from anything this screen sends. A plant
// cannot reach another plant from here even if this code asked it to.
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, RefreshCw, ShieldCheck, UserX, UserCheck } from 'lucide-react';
import { MEDIA_BROKER_BASE } from '../config/media.js';
import { subscribeCrew } from '../services/logs.js';
import { SITE_LEAD_LABEL } from '../utils/roles.js';
import { useVerifiedPerson } from '../utils/useVerifiedPerson.js';
import PinPrompt from './PinPrompt.jsx';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';

export default function PlantLoginsPage({ workspaceId, customerId, customerName, getIdToken }) {
  const toast = useToast();
  const dialog = useDialog();
  const [crewPeople, setCrewPeople] = useState([]);
  const [state, setState] = useState({ logins: [], included: 0, used: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [pending, setPending] = useState(null);      // action awaiting a Site Lead PIN
  const { person: actor, remember } = useVerifiedPerson(customerId);

  useEffect(() => {
    if (!workspaceId || !customerId) return undefined;
    return subscribeCrew(workspaceId, customerId, setCrewPeople);
  }, [workspaceId, customerId]);

  const call = useCallback(async (init) => {
    const token = await getIdToken();
    const res = await fetch(`${MEDIA_BROKER_BASE}/account/logins`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Server said ${res.status}`);
    return data;
  }, [getIdToken]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setState(await call({ method: 'GET' }));
    } catch (err) {
      setError(err.message || 'Could not load the logins for this plant.');
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { load(); }, [load]);

  // A Site Lead has to be present for anything that changes access. Having
  // proved it earlier in the shift is not enough here: adding a login outlives
  // the shift, so it asks every time.
  const asSiteLead = (run) => {
    const anyLead = crewPeople.some((p) => (p.siteLead ?? p.admin) && p.pinHash);
    if (!anyLead) {
      toast.error(`No ${SITE_LEAD_LABEL} has a PIN set yet — JTI sets the first one.`);
      return;
    }
    setPending(() => run);
  };

  const addLogin = () => asSiteLead(async () => {
    const addr = email.trim().toLowerCase();
    if (!addr.includes('@')) { toast.error('Enter the email address for the new login'); return; }
    setBusy(true);
    try {
      const data = await call({ method: 'POST', body: JSON.stringify({ email: addr }) });
      setCreated({ email: addr, setPasswordLink: data.setPasswordLink || '' });
      setEmail('');
      toast.success('Login added');
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not add that login');
    } finally {
      setBusy(false);
    }
  });

  const setDisabled = (login, disabled) => asSiteLead(async () => {
    const ok = await dialog.confirm(
      disabled
        ? `Suspend ${login.email}? They will not be able to sign in until this is undone.`
        : `Restore access for ${login.email}?`,
      { title: disabled ? 'Suspend login' : 'Restore login', confirmText: disabled ? 'Suspend' : 'Restore',
        variant: disabled ? 'danger' : 'primary' }
    );
    if (!ok) return;
    try {
      await call({ method: 'POST', body: JSON.stringify({ uid: login.uid, disabled }) });
      toast.success(disabled ? 'Login suspended' : 'Login restored');
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not change that login');
    }
  });

  const full = state.included > 0 && state.used >= state.included;

  return (
    <div className="p-3">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <h5 className="mb-0 d-flex align-items-center gap-2">
          <KeyRound size={18} /> Logins — {customerName || 'this plant'}
        </h5>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <p className="text-muted small">
        People who can sign into this app for {customerName || 'this plant'}. This is separate from
        the crew list: crew are the names on your entries, these are the accounts that open the app.
      </p>

      {error && <div className="alert alert-danger py-2">{error}</div>}

      <div className="d-flex align-items-center gap-2 mb-3">
        <span className={'badge ' + (full ? 'bg-warning text-dark' : 'bg-secondary')}>
          {state.used} of {state.included} in use
        </span>
        {full && <span className="small text-muted">All logins are in use — suspend one, or contact JTI.</span>}
      </div>

      <div className="list-group mb-3">
        {state.logins.length === 0 && !loading && (
          <div className="list-group-item text-muted">No logins found for this plant.</div>
        )}
        {state.logins.map((l) => (
          <div key={l.uid} className="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <div className="fw-semibold">
                {l.email}
                {l.disabled && <span className="badge bg-secondary ms-2">suspended</span>}
              </div>
              <div className="small text-muted">
                {l.lastSignIn ? `last signed in ${new Date(l.lastSignIn).toLocaleDateString()}` : 'never signed in'}
              </div>
            </div>
            <button
              type="button"
              className={'btn btn-sm ' + (l.disabled ? 'btn-outline-success' : 'btn-outline-danger')}
              onClick={() => setDisabled(l, !l.disabled)}
            >
              {l.disabled ? <><UserCheck size={14} /> Restore</> : <><UserX size={14} /> Suspend</>}
            </button>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-body">
          <div className="fw-semibold mb-1 d-flex align-items-center gap-2">
            <Plus size={15} /> Add a login
          </div>
          <p className="text-muted small mb-2">
            No password is set here — you will get a link to send them, and they choose their own.
            A {SITE_LEAD_LABEL} has to confirm with their PIN.
          </p>
          <div className="d-flex gap-2 flex-wrap">
            <input
              type="email"
              className="form-control form-control-sm"
              style={{ maxWidth: '280px' }}
              placeholder="name@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={full}
            />
            <button type="button" className="btn btn-sm btn-primary" onClick={addLogin} disabled={busy || full}>
              {busy ? 'Adding…' : 'Add login'}
            </button>
          </div>

          {created && (
            <div className="alert alert-success mt-2 mb-0 py-2">
              <div className="fw-semibold small">Login added for {created.email}</div>
              {created.setPasswordLink ? (
                <>
                  <div className="small mb-1">
                    Send them this link to set their password. It expires — if it lapses they can use
                    “Forgot password” on the sign-in screen.
                  </div>
                  <div className="d-flex gap-2">
                    <input readOnly value={created.setPasswordLink} className="form-control form-control-sm font-monospace"
                      onFocus={(e) => e.target.select()} />
                    <button type="button" className="btn btn-sm btn-outline-secondary flex-shrink-0"
                      onClick={() => { navigator.clipboard?.writeText(created.setPasswordLink); toast.success('Link copied'); }}>
                      Copy
                    </button>
                  </div>
                </>
              ) : (
                <div className="small">Ask them to use “Forgot password” on the sign-in screen.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {pending && (
        <PinPrompt
          customerId={customerId}
          people={crewPeople}
          requireSiteLead
          title={`${SITE_LEAD_LABEL} confirmation`}
          message="Changing who can sign in needs a Site Lead."
          onVerified={(p) => {
            remember(p);
            const run = pending;
            setPending(null);
            run();
          }}
          onCancel={() => setPending(null)}
        />
      )}
      {actor && (
        <div className="form-text mt-2 d-flex align-items-center gap-1">
          <ShieldCheck size={12} /> Last confirmed by {actor.name}
        </div>
      )}
    </div>
  );
}
