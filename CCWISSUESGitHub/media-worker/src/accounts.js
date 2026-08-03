// media-worker/src/accounts.js
//
// Creating a customer's login.
//
// Until now this was done by hand: make the account in the Firebase console,
// copy its UID, paste it into the app to write app_roles/{uid}. Three steps
// across two tools, and the UID is a forty-character string nobody can check by
// eye — so the failure mode was a login silently pointed at the wrong plant.
//
// It has to live in the Worker because creating an auth account needs
// privileges a browser must never hold. The Worker already has the service
// account and already verifies Firebase ID tokens, so the caller is proven to
// be a JTI admin before anything is created.
//
// Nothing here ever handles a password. The account is created without one and
// the customer sets their own through a Firebase-generated link, so no password
// passes through this code, the app, or an email you wrote.

const IDENTITY = 'https://identitytoolkit.googleapis.com/v1';

// Firebase Auth admin operations. `cloud-platform` covers Identity Toolkit and
// Firestore both, which is what account creation needs: one to make the login,
// one to record what it may reach.
export const ACCOUNT_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const json = (res, status = 200) =>
  new Response(JSON.stringify(res), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Google's errors are shaped for machines. These are the ones an admin can
// actually act on, in words that say what to do about them.
function readableError(code, raw) {
  switch (code) {
    case 'EMAIL_EXISTS':
      return 'That email already has an account. Link the existing account instead of creating a second one.';
    case 'INVALID_EMAIL':
      return 'That email address is not valid.';
    case 'PERMISSION_DENIED':
    case 'FORBIDDEN':
      return 'The service account is not allowed to create logins. It needs the '
        + 'Firebase Authentication Admin role on this project.';
    default:
      return raw || 'Could not create the account.';
  }
}

async function identityCall(path, token, projectId, body) {
  const res = await fetch(`${IDENTITY}/projects/${projectId}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error?.message || '';
    const err = new Error(readableError(code, code));
    err.status = res.status === 403 ? 403 : 400;
    throw err;
  }
  return data;
}

// Put the same role on the auth token as a custom claim.
//
// Two stores decide what an account may do, and they are read by different
// systems: the Firestore rules read app_roles/{uid}, while the storage rules
// and this Worker read a claim on the ID token — storage rules cannot read
// Firestore at all, which is why the claim exists.
//
// They were kept in step by a script someone had to remember to run. Setting
// the claim in the same call that writes the document removes the step, and
// with it the state where an account is an admin to one half of the system and
// a stranger to the other.
//
// The claim only reaches the client on its NEXT token refresh — immediately for
// an account that has not signed in yet, within the hour otherwise, or at once
// if they sign out and back in.
async function setClaims(token, projectId, uid, claims) {
  const res = await fetch(`${IDENTITY}/projects/${projectId}/accounts:update`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uid, customAttributes: JSON.stringify(claims) }),
  });
  if (!res.ok) {
    const err = new Error(`Access was recorded but the sign-in token was not updated: ${await res.text()}`);
    err.status = 500;
    err.uid = uid;
    throw err;
  }
}

// The claim that matches an app_roles document, so one function decides the
// shape in both places it is written.
const claimsForRole = (role) => (role.admin === true ? { admin: true } : { customerId: role.customerId });

// Read app_roles/{uid} back out of Firestore.
async function readRole(token, projectId, uid) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}`
    + `/databases/(default)/documents/app_roles/${encodeURIComponent(uid)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not read that account's access: ${await res.text()}`);
  const doc = await res.json();
  const f = doc.fields || {};
  return {
    admin: f.admin?.booleanValue === true,
    customerId: f.customerId?.stringValue || '',
  };
}

// Write app_roles/{uid} through the Firestore REST API.
//
// This is the document the security rules read to decide what a login may
// reach, so it is written here, by the same call that created the account —
// rather than left as a second step someone has to remember.
async function writeRole(token, projectId, uid, customerId) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}`
    + `/databases/(default)/documents/app_roles/${encodeURIComponent(uid)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { customerId: { stringValue: customerId } } }),
  });
  if (!res.ok) {
    const err = new Error(`Account was created but its access could not be recorded: ${await res.text()}`);
    err.status = 500;
    err.uid = uid;          // so the caller can report a half-finished state honestly
    throw err;
  }
}

// POST /admin/create-login  { email, customerId }
//
// Caller must already be verified as a JTI admin — this module does not decide
// that, index.js does, so authorisation lives in one place.
export async function createLogin(request, env, mintToken) {
  const body = await request.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const customerId = String(body.customerId || '').trim();

  if (!email || !email.includes('@')) return json({ error: 'An email address is required.' }, 400);
  if (!customerId) return json({ error: 'Pick which plant this login is for.' }, 400);

  const projectId = env.FIREBASE_PROJECT_ID;
  const token = await mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY, ACCOUNT_SCOPE);

  try {
    // No password: the account is created unusable until the customer sets one
    // through the link below. Nothing here ever sees or transmits a secret.
    const created = await identityCall('/accounts', token, projectId, {
      email,
      emailVerified: false,
      disabled: false,
    });
    const uid = created.localId;

    await writeRole(token, projectId, uid, customerId);
    // Same call, so the document and the token cannot disagree about a login
    // that has only just been made.
    await setClaims(token, projectId, uid, { customerId });

    // returnOobLink gives the link back instead of Firebase emailing it, so it
    // can be shown to the admin who is on the phone to the plant right now.
    const oob = await identityCall('/accounts:sendOobCode', token, projectId, {
      requestType: 'PASSWORD_RESET',
      email,
      returnOobLink: true,
    });

    return json({ uid, email, customerId, setPasswordLink: oob.oobLink || '' });
  } catch (err) {
    return json(
      { error: err.message || 'Could not create the account.', uid: err.uid || null },
      err.status || 400
    );
  }
}

// POST /admin/sync-claims  { uid }
//
// Puts the token claim back in step with app_roles for an account that already
// exists — the ones linked by pasting a UID, which write the document from the
// browser and cannot set a claim from there.
export async function syncClaims(request, env, mintToken) {
  const body = await request.json().catch(() => ({}));
  const uid = String(body.uid || '').trim();
  if (!uid) return json({ error: 'Which account?' }, 400);

  const projectId = env.FIREBASE_PROJECT_ID;
  const token = await mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY, ACCOUNT_SCOPE);

  try {
    const role = await readRole(token, projectId, uid);
    if (!role) return json({ error: 'That account has no access recorded to sync.' }, 404);
    await setClaims(token, projectId, uid, claimsForRole(role));
    return json({ uid, claims: claimsForRole(role) });
  } catch (err) {
    return json({ error: err.message || 'Could not update the sign-in token.' }, err.status || 400);
  }
}

export default { createLogin, syncClaims, ACCOUNT_SCOPE };
