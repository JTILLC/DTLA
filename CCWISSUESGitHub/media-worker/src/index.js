// CCW media broker (Cloudflare Worker)
// ---------------------------------------------------------------------------
// Serves issue/head photos and service-report PDFs to the customer viewer
// WITHOUT handing out permanent public URLs.
//
// Why this exists
// ---------------
// Firebase `getDownloadURL()` mints a tokenized link that BYPASSES Storage
// security rules by design — it is meant to be shareable. Consequences:
//   * a leaked photo URL stays readable forever;
//   * revoking a share link does NOT revoke file URLs already handed out;
//   * tightening the Storage read rule does not invalidate existing links.
// So share-link expiry, which is enforced properly in Firestore, had no
// equivalent for media. This Worker is that equivalent: every media request is
// re-authorised against the live share before a single byte is served.
//
// How a request is authorised
// ---------------------------
//   GET /m/<shareToken>/<storagePath>
//   1. Fetch shared_visits/<shareToken> from Firestore over the REST API,
//      UNAUTHENTICATED. That is deliberate: the Firestore rule already says
//      `allow get: if notExpired(...)`, so an expired or revoked share returns
//      403 and we never have to duplicate the expiry logic here. One source of
//      truth, and it cannot drift.
//   2. Confirm <storagePath> actually belongs to that share's workspace +
//      customer. Without this, any valid share token would be a key to every
//      tenant's media.
//   3. Stream the object from GCS using the Worker's own service-account
//      credential, which never reaches the browser.
//
// Also hosts POST /scan-weights (see weights.js) — a photo of a weigher screen
// in, head/weight pairs out. It lives here rather than in its own Worker because
// it needs exactly the same gate: a valid Firebase ID token checked against the
// same custom claims. Two Workers would mean two copies of that logic to keep in
// step, and a second place for it to drift.
//
// Secrets (wrangler secret put):
//   GCP_SA_EMAIL        service account email
//   GCP_SA_PRIVATE_KEY  its PEM private key (literal \n escapes are handled)
//   ANTHROPIC_API_KEY   for /scan-weights only
//   PARTS_SA_EMAIL / PARTS_SA_PRIVATE_KEY  for /parts/* only (parts project)
// Vars (wrangler.toml): FIREBASE_PROJECT_ID, STORAGE_BUCKET, ALLOWED_ORIGIN

import { scanWeights, mayScan } from './weights.js';
import { catalog, partsForFolder, partsConfigured } from './parts.js';

const TEXT = { 'Content-Type': 'text/plain; charset=utf-8' };
const JSON_CT = { 'Content-Type': 'application/json; charset=utf-8' };

const originAllowed = (origin, list) => {
  if (!origin) return false;
  for (const entry of list) {
    if (entry === '*' || entry === origin) return true;
    // '*.foo.pages.dev' matches any subdomain — Cloudflare Pages gives every
    // preview deploy its own hostname (<branch>. and <hash>.), so pinning only
    // the production origins silently breaks every preview build.
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(1);            // '.foo.pages.dev'
      try {
        const host = new URL(origin).host;
        if (host.endsWith(suffix) && host.length > suffix.length) return true;
      } catch { /* malformed Origin */ }
    }
  }
  return false;
};

const corsHeaders = (origin, allowed) => {
  // Media is fetched with JS (an <img> can't send Authorization), so these
  // requests are CORS-checked. Echo only an allow-listed origin.
  const list = (allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = originAllowed(origin, list);
  return ok
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
        'Vary': 'Origin',
      }
    : { 'Vary': 'Origin' };
};

const deny = (status, message, origin, allowed) =>
  new Response(message, { status, headers: { ...TEXT, ...corsHeaders(origin, allowed) } });

// --- Google service-account auth -------------------------------------------
// Mint an OAuth access token from the service account (RS256 JWT bearer flow).
// Cached in module scope for the token's lifetime minus a safety margin, so a
// warm isolate signs at most once an hour rather than once per image.

const b64url = (buf) => {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const pemToPkcs8 = (pem) => {
  const body = pem
    .replace(/\\n/g, '\n')                     // wrangler secrets often arrive escaped
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
};

// Cache per (account, scope). The parts catalog lives in a different GCP
// project with its own service account, so one shared slot would have the two
// evicting each other on every alternating request.
const tokenCaches = new Map();

async function mintToken(email, privateKey, scope) {
  const cacheKey = `${email}|${scope}`;
  const now = Math.floor(Date.now() / 1000);
  const hit = tokenCaches.get(cacheKey);
  if (hit && now < hit.expiresAt) return hit.value;

  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: email,
        scope,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      })
    )
  );

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKey),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(`${header}.${claim}`)
  );
  const jwt = `${header}.${claim}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  tokenCaches.set(cacheKey, {
    value: data.access_token,
    expiresAt: now + (data.expires_in || 3600) - 120,
  });
  return data.access_token;
}

const getAccessToken = (env) =>
  mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY, 'https://www.googleapis.com/auth/devstorage.read_only');

const getPartsToken = (env) =>
  mintToken(env.PARTS_SA_EMAIL, env.PARTS_SA_PRIVATE_KEY, 'https://www.googleapis.com/auth/datastore');

// --- Share validation -------------------------------------------------------
// Unauthenticated read: the Firestore rule enforces expiry for us, so an
// expired/revoked token yields 403 here and the media request dies with it.
async function loadShare(env, shareToken) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}` +
    `/databases/(default)/documents/shared_visits/${encodeURIComponent(shareToken)}`;
  const res = await fetch(url);
  if (res.status === 403 || res.status === 404) return null;   // expired, revoked, or never existed
  if (!res.ok) throw new Error(`share lookup failed: ${res.status}`);
  const doc = await res.json();
  const f = doc.fields || {};
  return {
    workspaceId: f.userId?.stringValue,
    customerId: f.customerId?.stringValue,
  };
}

// --- Firebase ID token verification (authenticated app users) ---------------
// Field techs are logged in, so once objects lose their public download token
// the apps need an authenticated way to read media. They send their Firebase ID
// token as a bearer header and we authorise off the SAME custom claims that
// storage.rules uses — one authorisation model, not two.
//
// Google publishes the signing keys as JWKs, which Web Crypto imports directly
// (the X.509 cert endpoint would need certificate parsing first).
const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let jwksCache = { keys: null, expiresAt: 0 };

async function getJwks() {
  const now = Date.now();
  if (jwksCache.keys && now < jwksCache.expiresAt) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const data = await res.json();
  // Respect the endpoint's cache lifetime; fall back to an hour.
  const cc = res.headers.get('cache-control') || '';
  const maxAge = Number((cc.match(/max-age=(\d+)/) || [])[1] || 3600);
  jwksCache = { keys: data.keys, expiresAt: now + maxAge * 1000 };
  return data.keys;
}

const b64urlToBytes = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

// Returns the token's claims, or null if it is not a valid, unexpired ID token
// for one of the accepted projects.
//
// `projectIds` takes a string or an array. Media routes pass the single CCW
// project; /scan-weights passes the allow-list, because the Shearers app is a
// SEPARATE Firebase project (shearers-4c4b4) whose tokens would otherwise fail
// the audience check. The issuer is then checked against the audience we
// accepted, so a token cannot claim one project and be issued by another.
async function verifyIdToken(jwt, projectIds) {
  const allowed = Array.isArray(projectIds) ? projectIds : [projectIds];
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;

  // Decode defensively. A malformed token is a CLIENT error (401), not an
  // upstream failure — letting a parse throw here would surface as a 502 and
  // mask genuine broker outages.
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  } catch {
    return null;
  }
  if (!header || !payload) return null;
  if (header.alg !== 'RS256' || !header.kid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return null;
  if (!allowed.includes(payload.aud)) return null;
  if (payload.iss !== `https://securetoken.google.com/${payload.aud}`) return null;
  if (!payload.sub) return null;

  const jwk = (await getJwks()).find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
  } catch {
    return null;   // bad signature encoding is a client error, not a 502
  }
  return ok ? payload : null;
}

// Mirrors storage.rules: admins go anywhere, a customer login only under its own
// customer id.
const pathAllowedForClaims = (path, claims) => {
  if (path.includes('..')) return false;
  const m = path.match(/^(?:issue-photos|service-reports)\/[^/]+\/([^/]+)\//);
  if (!m) return false;
  if (claims.admin === true) return true;
  return !!claims.customerId && claims.customerId === m[1];
};

// The path must sit under this share's workspace AND customer, or one valid
// share token would unlock every tenant's media.
const pathAllowedForShare = (path, share) => {
  if (!share?.workspaceId || !share?.customerId) return false;
  if (path.includes('..')) return false;
  const prefixes = [
    `issue-photos/${share.workspaceId}/${share.customerId}/`,
    `service-reports/${share.workspaceId}/${share.customerId}/`,
  ];
  return prefixes.some((p) => path.startsWith(p));
};

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGIN;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }

    const url = new URL(request.url);

    // --- POST /scan-weights: read a weigher screen ---------------------------
    if (url.pathname === '/scan-weights') {
      if (request.method !== 'POST') return deny(405, 'Method not allowed', origin, allowed);
      // Unlike media GETs, this one spends money per call, so an unrecognised
      // caller must not reach the model at all.
      if (!originAllowed(origin, (allowed || '').split(',').map((s) => s.trim()).filter(Boolean))) {
        return deny(403, 'Origin not permitted.', origin, allowed);
      }
      if (!env.ANTHROPIC_API_KEY) {
        return deny(503, 'Screen reading is not configured yet.', origin, allowed);
      }

      const auth = request.headers.get('Authorization') || '';
      const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!jwt) return deny(401, 'Sign-in required.', origin, allowed);

      // Accepts the CCW project plus any other allow-listed one (Shearers).
      const scanProjects = (env.SCAN_PROJECT_IDS || env.FIREBASE_PROJECT_ID)
        .split(',').map((s) => s.trim()).filter(Boolean);

      let claims;
      try {
        claims = await verifyIdToken(jwt, scanProjects);
      } catch (err) {
        console.error('id token verify error', err);
        return deny(502, 'Upstream auth error', origin, allowed);
      }
      if (!claims) return deny(401, 'Session expired — sign in again.', origin, allowed);
      if (!mayScan(claims, env.FIREBASE_PROJECT_ID)) {
        return deny(403, 'Not permitted for this account.', origin, allowed);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return deny(400, 'Expected a JSON body.', origin, allowed);
      }

      try {
        const result = await scanWeights(env, claims, body);
        return new Response(JSON.stringify(result), {
          headers: { ...JSON_CT, ...corsHeaders(origin, allowed) },
        });
      } catch (err) {
        // Anything without an explicit status is an upstream failure, not the
        // caller's fault — don't blame the operator for our outage.
        const status = err?.status || 502;
        // err.cause carries the upstream body when the message was rewritten for
        // the operator — log it, or the real reason is lost.
        if (status >= 500) console.error('scan-weights error', err?.message, err?.cause || err);
        return deny(status, err?.message || 'Screen reading failed.', origin, allowed);
      }
    }

    // --- GET /parts/*: the machine's parts manual ----------------------------
    if (url.pathname.startsWith('/parts/')) {
      if (request.method !== 'GET') return deny(405, 'Method not allowed', origin, allowed);
      if (!partsConfigured(env)) {
        return deny(503, 'Parts lookup is not configured yet.', origin, allowed);
      }

      const auth = request.headers.get('Authorization') || '';
      const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!jwt) return deny(401, 'Sign-in required.', origin, allowed);

      const scanProjects = (env.SCAN_PROJECT_IDS || env.FIREBASE_PROJECT_ID)
        .split(',').map((s) => s.trim()).filter(Boolean);
      let claims;
      try {
        claims = await verifyIdToken(jwt, scanProjects);
      } catch (err) {
        console.error('id token verify error', err);
        return deny(502, 'Upstream auth error', origin, allowed);
      }
      if (!claims) return deny(401, 'Session expired — sign in again.', origin, allowed);
      if (claims.firebase?.sign_in_provider === 'anonymous') {
        return deny(403, 'Not permitted for this account.', origin, allowed);
      }

      try {
        const token = await getPartsToken(env);

        // The whole customer -> folder tree is the JTI binding screen. It names
        // every customer in the parts catalog, so it stays admin-only — a plant
        // login has no business enumerating other plants.
        if (url.pathname === '/parts/catalog') {
          if (claims.admin !== true) {
            return deny(403, 'Not permitted for this account.', origin, allowed);
          }
          const data = await catalog(env, token);
          return new Response(JSON.stringify({ customers: data }), {
            headers: { ...JSON_CT, ...corsHeaders(origin, allowed) },
          });
        }

        // Parts for one bound machine. Part numbers themselves are not
        // sensitive — the risk is picking one off the WRONG machine, which the
        // caller's binding prevents by only ever asking for its own folder.
        if (url.pathname === '/parts/parts') {
          const customer = (url.searchParams.get('customer') || '').trim();
          const folder = (url.searchParams.get('folder') || '').trim();
          if (!customer || !folder) {
            return deny(400, 'Missing customer or folder.', origin, allowed);
          }
          const parts = await partsForFolder(env, token, customer, folder);
          const headers = new Headers({ ...JSON_CT, ...corsHeaders(origin, allowed) });
          // A manual changes rarely; let the browser keep it for a few minutes
          // so typing in the part field isn't a request per keystroke.
          headers.set('Cache-Control', 'private, max-age=300');
          return new Response(JSON.stringify({ customer, folder, parts }), { headers });
        }

        return deny(404, 'Not found', origin, allowed);
      } catch (err) {
        console.error('parts lookup error', err?.message || err);
        return deny(err?.status || 502, 'Could not read the parts manual.', origin, allowed);
      }
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return deny(405, 'Method not allowed', origin, allowed);
    }

    if (url.pathname === '/health') {
      // Reports which optional features have their secrets, as booleans only —
      // never a value or a prefix. Without this, a missing secret is
      // indistinguishable from a bad deploy from the outside.
      return new Response(
        JSON.stringify({
          ok: true,
          media: !!env.GCP_SA_EMAIL && !!env.GCP_SA_PRIVATE_KEY,
          scanWeights: !!env.ANTHROPIC_API_KEY,
          parts: partsConfigured(env),
        }),
        { headers: { ...JSON_CT, ...corsHeaders(origin, allowed) } }
      );
    }

    let storagePath = null;

    // /m/<shareToken>/<path> — customer viewer, authorised by the share link.
    const m = url.pathname.match(/^\/m\/([^/]+)\/(.+)$/);
    // /a/<path> — logged-in field app, authorised by Firebase ID token + claims.
    const a = url.pathname.match(/^\/a\/(.+)$/);

    if (m) {
      const shareToken = decodeURIComponent(m[1]);
      storagePath = decodeURIComponent(m[2]);
      let share;
      try {
        share = await loadShare(env, shareToken);
      } catch (err) {
        console.error('share lookup error', err);
        return deny(502, 'Upstream error', origin, allowed);
      }
      if (!share) return deny(403, 'This link has expired or been revoked.', origin, allowed);
      if (!pathAllowedForShare(storagePath, share)) {
        return deny(403, 'Not available on this link.', origin, allowed);
      }
    } else if (a) {
      storagePath = decodeURIComponent(a[1]);
      const auth = request.headers.get('Authorization') || '';
      const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!jwt) return deny(401, 'Sign-in required.', origin, allowed);

      let claims;
      try {
        claims = await verifyIdToken(jwt, env.FIREBASE_PROJECT_ID);
      } catch (err) {
        console.error('id token verify error', err);
        return deny(502, 'Upstream auth error', origin, allowed);
      }
      if (!claims) return deny(401, 'Session expired — sign in again.', origin, allowed);
      if (!pathAllowedForClaims(storagePath, claims)) {
        return deny(403, 'Not permitted for this account.', origin, allowed);
      }
    } else {
      return deny(404, 'Not found', origin, allowed);
    }

    let accessToken;
    try {
      accessToken = await getAccessToken(env);
    } catch (err) {
      console.error('auth error', err);
      return deny(502, 'Upstream auth error', origin, allowed);
    }

    const objUrl =
      `https://storage.googleapis.com/storage/v1/b/${env.STORAGE_BUCKET}` +
      `/o/${encodeURIComponent(storagePath)}?alt=media`;
    const range = request.headers.get('Range');
    const upstream = await fetch(objUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(range ? { Range: range } : {}),
      },
    });

    if (!upstream.ok && upstream.status !== 206) {
      return deny(upstream.status === 404 ? 404 : 502, 'File not available', origin, allowed);
    }

    const headers = new Headers(corsHeaders(origin, allowed));
    for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag']) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    // Private: the response is only valid for this share, so shared caches
    // (including Cloudflare's) must not serve it to someone else. The browser
    // may still cache it, which is what makes scrolling a gallery cheap.
    headers.set('Cache-Control', 'private, max-age=600');
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
