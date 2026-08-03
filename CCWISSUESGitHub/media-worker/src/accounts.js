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
// The normal path handles no password at all: the account is created without
// one and the customer sets their own through a Firebase-generated link.
//
// A password MAY be supplied instead, for an address that cannot receive mail —
// a test account, or a plant that has no inbox of its own. It is passed
// straight to Google and never stored, logged or echoed back here. It is the
// weaker option and stays opt-in, because it means JTI knows a password the
// customer did not choose.

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
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !email.includes('@')) return json({ error: 'An email address is required.' }, 400);
  if (!customerId) return json({ error: 'Pick which plant this login is for.' }, 400);
  // Firebase's own floor is six. Checked here so the failure is a sentence
  // rather than a Google error code arriving at the browser.
  if (password && password.length < 6) {
    return json({ error: 'A password must be at least 6 characters, or leave it blank to send a link.' }, 400);
  }

  const projectId = env.FIREBASE_PROJECT_ID;
  const token = await mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY, ACCOUNT_SCOPE);

  try {
    // Without a password the account is unusable until the customer sets one
    // through the link below, which is the intended path.
    const created = await identityCall('/accounts', token, projectId, {
      email,
      emailVerified: false,
      disabled: false,
      ...(password ? { password } : {}),
    });
    const uid = created.localId;

    await writeRole(token, projectId, uid, customerId);
    // Same call, so the document and the token cannot disagree about a login
    // that has only just been made.
    await setClaims(token, projectId, uid, { customerId });

    // A link is only worth generating when there is no password to use. Asking
    // for one anyway would hand back a way to override the password just set.
    let setPasswordLink = '';
    if (!password) {
      // returnOobLink gives the link back instead of Firebase emailing it, so
      // it can be shown to the admin on the phone to the plant right now.
      const oob = await identityCall('/accounts:sendOobCode', token, projectId, {
        requestType: 'PASSWORD_RESET',
        email,
        returnOobLink: true,
      });
      setPasswordLink = oob.oobLink || '';
    }

    return json({ uid, email, customerId, setPasswordLink, passwordSet: !!password });
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


// ---- The plant managing its own logins -------------------------------------
//
// A plant signs in on a shared tablet, so one login covers everybody. Some
// sites want a second or third — the night supervisor, a second building — and
// waiting on JTI for that is friction with no purpose.
//
// The customer is NEVER taken from the request. It comes from the caller's own
// token, so a plant can only ever create a login for itself; a body field would
// be a plant's route into another plant's data.

// How many logins a plant may hold before JTI has to be involved. Overridable
// per customer from the billing document, which only JTI can write.
const DEFAULT_INCLUDED_LOGINS = 3;

async function firestoreGet(token, projectId, path) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function seatsFor(token, projectId, customerId) {
  const doc = await firestoreGet(token, projectId, `billing/${encodeURIComponent(customerId)}`)
    .catch(() => null);
  const n = Number(doc?.fields?.includedLogins?.integerValue);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_INCLUDED_LOGINS;
}

// Every login pointed at this customer.
async function loginsFor(token, projectId, customerId) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'app_roles' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'customerId' },
              op: 'EQUAL',
              value: { stringValue: customerId },
            },
          },
          limit: 50,
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Could not list logins: ${await res.text()}`);
  const rows = await res.json();
  const uids = (Array.isArray(rows) ? rows : [])
    .filter((r) => r.document)
    .map((r) => r.document.name.split('/').pop());
  if (!uids.length) return [];

  // Emails and disabled state live on the auth account, not the role document.
  const look = await fetch(`${IDENTITY}/projects/${projectId}/accounts:lookup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ localId: uids }),
  });
  const data = await look.json().catch(() => ({}));
  const byUid = new Map((data.users || []).map((u) => [u.localId, u]));
  return uids.map((uid) => {
    const u = byUid.get(uid) || {};
    return {
      uid,
      email: u.email || '(unknown)',
      disabled: !!u.disabled,
      lastSignIn: u.lastLoginAt ? Number(u.lastLoginAt) : null,
    };
  });
}

// GET  /account/logins            — list this plant's logins and its allowance
// POST /account/logins  { email } — add one
// POST /account/logins  { uid, disabled } — suspend or restore one
export async function plantLogins(request, env, mintToken, customerId) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const token = await mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY, ACCOUNT_SCOPE);

  try {
    if (request.method === 'GET') {
      const [logins, included] = await Promise.all([
        loginsFor(token, projectId, customerId),
        seatsFor(token, projectId, customerId),
      ]);
      return json({ logins, included, used: logins.filter((l) => !l.disabled).length });
    }

    const body = await request.json().catch(() => ({}));

    // Suspend or restore. Scoped by re-reading the role: a uid from the request
    // is only acted on once this customer is confirmed to own it.
    if (body.uid) {
      const role = await readRole(token, projectId, String(body.uid));
      if (!role || role.customerId !== customerId) {
        return json({ error: 'That login does not belong to this plant.' }, 403);
      }
      await identityCall('/accounts:update', token, projectId, {
        localId: String(body.uid),
        disableUser: body.disabled !== false,
      });
      return json({ uid: body.uid, disabled: body.disabled !== false });
    }

    const email = String(body.email || '').trim().toLowerCase();
    if (!email.includes('@')) return json({ error: 'An email address is required.' }, 400);

    const [logins, included] = await Promise.all([
      loginsFor(token, projectId, customerId),
      seatsFor(token, projectId, customerId),
    ]);
    const active = logins.filter((l) => !l.disabled).length;
    if (active >= included) {
      return json({
        error: `This plant is using all ${included} of its logins. `
          + 'Suspend one that is no longer needed, or contact JTI to add more.',
      }, 409);
    }

    const created = await identityCall('/accounts', token, projectId, {
      email, emailVerified: false, disabled: false,
    });
    const uid = created.localId;
    await writeRole(token, projectId, uid, customerId);
    await setClaims(token, projectId, uid, { customerId });
    const oob = await identityCall('/accounts:sendOobCode', token, projectId, {
      requestType: 'PASSWORD_RESET', email, returnOobLink: true,
    });
    return json({ uid, email, setPasswordLink: oob.oobLink || '', used: active + 1, included });
  } catch (err) {
    return json({ error: err.message || 'Could not do that.' }, err.status || 400);
  }
}


// ---- JTI listing and resetting a plant's logins ----------------------------
//
// The plant's own screen scopes itself to the caller's token. JTI has no
// customerId of its own, so it names the plant explicitly — which is safe only
// because index.js has already proved the caller is a JTI admin.

// POST /admin/logins  { customerId }
export async function adminListLogins(request, env, mintToken) {
  const body = await request.json().catch(() => ({}));
  const customerId = String(body.customerId || '').trim();
  if (!customerId) return json({ error: 'Which plant?' }, 400);
  const projectId = env.FIREBASE_PROJECT_ID;
  const token = await mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY, ACCOUNT_SCOPE);
  try {
    return json({ logins: await loginsFor(token, projectId, customerId) });
  } catch (err) {
    return json({ error: err.message || 'Could not list logins.' }, err.status || 400);
  }
}

// POST /admin/reset-password  { uid, password? }
//
// With a password, it is set and the account can be used at once — for an
// address that cannot receive mail. Without one, a reset link comes back to
// send on, which is the better route whenever there is an inbox.
//
// Same rule as creation: never both. A link handed back beside a password just
// set is a way to override it.
export async function adminResetPassword(request, env, mintToken) {
  const body = await request.json().catch(() => ({}));
  const uid = String(body.uid || '').trim();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!uid) return json({ error: 'Which account?' }, 400);
  if (password && password.length < 6) {
    return json({ error: 'A password must be at least 6 characters, or leave it blank to get a link.' }, 400);
  }

  const projectId = env.FIREBASE_PROJECT_ID;
  const token = await mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY, ACCOUNT_SCOPE);
  try {
    // The email is read from the account rather than taken from the request:
    // a reset link is sent to whatever address is passed, so accepting one
    // would let a caller point another account's reset at their own inbox.
    const look = await fetch(`${IDENTITY}/projects/${projectId}/accounts:lookup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: [uid] }),
    });
    const found = await look.json().catch(() => ({}));
    const email = found?.users?.[0]?.email;
    if (!email) return json({ error: 'That account no longer exists.' }, 404);

    if (password) {
      await identityCall('/accounts:update', token, projectId, { localId: uid, password });
      return json({ uid, email, passwordSet: true });
    }
    const oob = await identityCall('/accounts:sendOobCode', token, projectId, {
      requestType: 'PASSWORD_RESET', email, returnOobLink: true,
    });
    return json({ uid, email, setPasswordLink: oob.oobLink || '' });
  } catch (err) {
    return json({ error: err.message || 'Could not reset that password.' }, err.status || 400);
  }
}

export default { createLogin, syncClaims, plantLogins, adminListLogins, adminResetPassword, ACCOUNT_SCOPE };
