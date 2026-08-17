// src/shearers.js
//
// Downtime data for a customer holding a share link.
//
// The viewer used to read the Realtime Database directly, which meant the
// downtime data had to be world-readable for it to work at all — every stop,
// every fault note, every photo caption, available to anyone who knew the
// database URL. The share link was decoration: nothing checked it, because
// nothing needed to.
//
// It is checked here instead. The viewer sends its token, this validates it
// against the shares node using a service account, and returns only the data a
// valid share entitles it to. The database itself can then be closed, which is
// the point.
//
// Same shape as the CCW media broker next door, and for the same reason: a
// browser cannot be trusted with a credential, so the credential stays here and
// the browser proves it holds a link somebody was given.

const DB = 'https://shearers-4c4b4-default-rtdb.firebaseio.com';

const SCOPE = 'https://www.googleapis.com/auth/firebase.database '
  + 'https://www.googleapis.com/auth/userinfo.email';

// What a share may fetch. A fixed list rather than a path parameter — an
// arbitrary path would let a token holder walk the whole tree, which is what
// this exists to stop.
const READABLE = {
  data: 'jti-downtime/main-logger/data',
  history: 'jti-downtime/head-history',
};

const dbGet = async (path, access) => {
  const res = await fetch(`${DB}/${path}.json`, { headers: { Authorization: `Bearer ${access}` } });
  if (!res.ok) throw new Error(`database read failed: ${res.status}`);
  return res.json();
};

/**
 * @param {string} which - 'data' or 'history'
 * @returns {{status:number, body:string, json?:boolean}}
 */
export async function shearersRead(request, env, mintToken, which) {
  if (!env.SHEARERS_SA_EMAIL || !env.SHEARERS_SA_PRIVATE_KEY) {
    return { status: 503, body: 'Shared downtime views are not configured on the server.' };
  }

  const path = READABLE[which];
  if (!path) return { status: 404, body: 'Not found' };

  const token = (new URL(request.url).searchParams.get('token') || '').trim();
  // Shape-checked before it is put in a URL. A token is the only credential
  // here, so anything that is not one is refused rather than looked up.
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(token)) {
    return { status: 400, body: 'A share link is required.' };
  }

  let access;
  try {
    access = await mintToken(env.SHEARERS_SA_EMAIL, env.SHEARERS_SA_PRIVATE_KEY, SCOPE);
  } catch (err) {
    console.error('shearers token mint failed', err);
    return { status: 502, body: 'Could not reach the downtime database.' };
  }

  let share;
  try {
    share = await dbGet(`jti-downtime/shares/${encodeURIComponent(token)}`, access);
  } catch (err) {
    console.error('shearers share lookup failed', err);
    return { status: 502, body: 'Could not check that share link.' };
  }

  // A link that was never issued and one that was revoked answer the same way.
  // Telling them apart would confirm which tokens exist.
  if (!share) return { status: 403, body: 'That share link is not valid.' };

  if (share.expiresAt) {
    const until = Date.parse(share.expiresAt);
    if (Number.isFinite(until) && until < Date.now()) {
      return { status: 403, body: 'That share link has expired.' };
    }
  }
  if (share.revoked === true) return { status: 403, body: 'That share link is not valid.' };

  try {
    const value = await dbGet(path, access);
    return { status: 200, body: JSON.stringify(value ?? null), json: true };
  } catch (err) {
    console.error('shearers data read failed', err);
    return { status: 502, body: 'Could not read the downtime data.' };
  }
}

export default { shearersRead };
