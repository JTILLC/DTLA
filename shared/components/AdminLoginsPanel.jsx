// shared/components/AdminLoginsPanel.jsx
//
// JTI's screen for giving a plant a way in.
//
// Two things, in the order they are usually needed:
//
//   1. Create a login outright — email, plant, done. The account is made and
//      told what it may reach in one call, and you get a link to send them.
//   2. Link an account that already exists, by UID. Kept for accounts made
//      elsewhere and for granting JTI Staff, but no longer the way a new plant
//      gets set up.
//
// Shared rather than duplicated: it started in the multi-tenant app because
// that is where the admin machinery lived, and belongs in the app JTI actually
// works in. Both now render the same component, so the two cannot drift.
//
// No password is set or transmitted here. Creating an account and setting a
// custom claim need privileges a browser must never hold, so both happen in the
// media Worker, which proves the caller is a JTI admin first.
import { useState } from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { Lock } from 'lucide-react';
import { MEDIA_BROKER_BASE } from '../config/media.js';

export default function AdminLoginsPanel({ customers = [], currentCustomerId = '', onClose, toast }) {
  const [newEmail, setNewEmail] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [linkUid, setLinkUid] = useState('');
  const [linkTarget, setLinkTarget] = useState(currentCustomerId);
  const [linkBusy, setLinkBusy] = useState(false);

  const idToken = () => firebase.auth().currentUser.getIdToken();

  const createLogin = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email.includes('@')) { toast.error('Enter the email address for the new login'); return; }
    if (!linkTarget || linkTarget === '__admin__') { toast.error('Choose which plant this login is for'); return; }
    setCreateBusy(true);
    try {
      const res = await fetch(`${MEDIA_BROKER_BASE}/admin/create-login`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await idToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, customerId: linkTarget }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Server said ${res.status}`);
      setCreated({ email, setPasswordLink: data.setPasswordLink || '' });
      setNewEmail('');
      toast.success('Account created');
    } catch (err) {
      console.error('Create login failed:', err);
      toast.error(err.message || 'Could not create the account');
    } finally {
      setCreateBusy(false);
    }
  };

  const linkExisting = async () => {
    const uid = linkUid.trim();
    if (!uid) { toast.error('Paste the account UID first'); return; }
    if (!linkTarget) { toast.error('Choose which plant (or JTI Staff) this login is for'); return; }
    setLinkBusy(true);
    try {
      const roleData = linkTarget === '__admin__' ? { admin: true } : { customerId: linkTarget };
      await firebase.firestore().collection('app_roles').doc(uid).set(roleData);

      // Put the sign-in token in step with what was just recorded. The document
      // governs Firestore; a claim on the token governs the storage rules and
      // the media Worker, which cannot read Firestore. Only the Worker can set
      // a claim, so it is asked to — and a failure is reported rather than
      // swallowed, because a half-linked account looks fine until it doesn't.
      try {
        const res = await fetch(`${MEDIA_BROKER_BASE}/admin/sync-claims`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${await idToken()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Server said ${res.status}`);
        }
      } catch (err) {
        console.error('Claim sync failed:', err);
        toast.error(
          'Access was recorded, but their sign-in token was not updated: '
          + (err.message || 'unknown error')
          + '. They may not be able to open photos until this is retried.'
        );
      }

      const where = linkTarget === '__admin__'
        ? 'JTI Staff'
        : (customers.find((c) => c.id === linkTarget)?.name || linkTarget);
      toast.success(`Login linked to ${where}. If they are already signed in, have them sign out and back in.`);
      setLinkUid('');
    } catch (err) {
      console.error('Link login failed:', err);
      toast.error('Could not link login: ' + (err?.message || 'unknown error'));
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <div className="p-3 bg-light border-bottom">
      <div className="d-flex justify-content-between align-items-start mb-2">
        <h6 className="mb-0 d-flex align-items-center gap-2"><Lock className="w-4 h-4" /> Plant logins</h6>
        <button onClick={() => { setCreated(null); onClose?.(); }} className="btn btn-sm btn-outline-secondary">
          Close
        </button>
      </div>

      <div className="border rounded p-2 mb-3">
        <div className="fw-semibold small mb-1">Create a new login</div>
        <p className="text-muted small mb-2">
          Makes the account and gives it access to one plant, in one step. No password is set
          here — you get a link to send them, and they choose their own.
        </p>
        <div className="row g-2 align-items-end">
          <div className="col-md-5">
            <label className="form-label small mb-1" htmlFor="new-login-email">Their email</label>
            <input
              id="new-login-email"
              type="email"
              placeholder="ops@flagstonefoods.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="form-control form-control-sm"
            />
          </div>
          <div className="col-md-4">
            <label className="form-label small mb-1" htmlFor="new-login-plant">Plant</label>
            <select
              id="new-login-plant"
              value={linkTarget}
              onChange={(e) => setLinkTarget(e.target.value)}
              className="form-select form-select-sm"
            >
              <option value="">-- Select plant --</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <button type="button" onClick={createLogin} disabled={createBusy} className="btn btn-primary btn-sm w-100">
              {createBusy ? 'Creating…' : 'Create account'}
            </button>
          </div>
        </div>

        {created && (
          <div className="alert alert-success mt-2 mb-0 py-2">
            <div className="fw-semibold small">Account created for {created.email}</div>
            {created.setPasswordLink ? (
              <>
                <div className="small mb-1">
                  Send them this link to set their password. It is single-use and expires — if it
                  lapses, they can use “Forgot password” on the sign-in screen.
                </div>
                <div className="d-flex gap-2 align-items-center">
                  <input
                    readOnly
                    value={created.setPasswordLink}
                    className="form-control form-control-sm font-monospace"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary flex-shrink-0"
                    onClick={() => {
                      navigator.clipboard?.writeText(created.setPasswordLink);
                      toast.success('Link copied');
                    }}
                  >
                    Copy
                  </button>
                </div>
              </>
            ) : (
              <div className="small">
                Ask them to use “Forgot password” on the sign-in screen to set one.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="fw-semibold small mb-1">Link an account that already exists</div>
      <p className="text-muted small mb-2">
        For an account made elsewhere, or to grant JTI Staff access. Paste its <strong>User UID</strong> and
        choose the plant. Quickest way to get the UID: have them sign in once — they'll be told the
        account isn't set up yet, and that screen shows their Account ID with a Copy button.
      </p>
      <div className="row g-2 align-items-end">
        <div className="col-md-5">
          <label className="form-label small mb-1" htmlFor="link-uid">Account UID</label>
          <input
            id="link-uid"
            placeholder="e.g. p8lv0o4pQNN43PQSIdx2rR9kW5B3"
            value={linkUid}
            onChange={(e) => setLinkUid(e.target.value)}
            className="form-control form-control-sm font-monospace"
          />
        </div>
        <div className="col-md-4">
          <label className="form-label small mb-1" htmlFor="link-target">Access</label>
          <select
            id="link-target"
            value={linkTarget}
            onChange={(e) => setLinkTarget(e.target.value)}
            className="form-select form-select-sm"
          >
            <option value="">-- Select plant --</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="__admin__">JTI Staff — every plant</option>
          </select>
        </div>
        <div className="col-md-3">
          <button type="button" onClick={linkExisting} disabled={linkBusy} className="btn btn-secondary btn-sm w-100">
            {linkBusy ? 'Linking…' : 'Link login'}
          </button>
        </div>
      </div>
    </div>
  );
}
