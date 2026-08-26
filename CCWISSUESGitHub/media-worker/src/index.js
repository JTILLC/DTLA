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
import { visionOcr, mayUseVision } from './vision.js';
import { runBackup, getManifest, finalizeNightly, NIGHTLY_GROUPS } from './backup.js';
import { publishDirectory } from './publish.js';
import { shearersRead } from './shearers.js';
import { scanReceipt, mayScanReceipt } from './receipts.js';
import { createLogin, syncClaims, plantLogins, adminListLogins, adminResetPassword } from './accounts.js';
import {
  billingConfigured, summary as billingSummary, checkout as billingCheckout,
  portal as billingPortal, webhook as billingWebhook,
} from './billing.js';
import { ACCOUNT_SCOPE } from './accounts.js';
import {
  catalog, partsForFolder, partsConfigured, diagramMeta, diagramImage, diagramsForFolder,
  foldersForCustomers,
} from './parts.js';

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

// Both scopes: Firestore for the catalog, Storage for the drawings. The cache
// is keyed by (account, scope), so this is one entry rather than two.
const getPartsToken = (env) =>
  mintToken(
    env.PARTS_SA_EMAIL,
    env.PARTS_SA_PRIVATE_KEY,
    'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/devstorage.read_only'
  );

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
// Every media prefix laid out as workspace/customer/…, which is what makes the
// customer id checkable from the path alone.
//
// pm-images and prestart-photos were missing here. Both are written by the apps
// and served only through this broker, so a photo uploaded to either simply
// never appeared — the fetch 403'd and the caller fell back to a legacy public
// URL that broker-only uploads do not have. Silent, because a missing photo
// looks like a photo nobody took.
const MEDIA_PREFIXES = ['issue-photos', 'service-reports', 'pm-images', 'prestart-photos'];

const pathAllowedForClaims = (path, claims) => {
  if (path.includes('..')) return false;
  const m = path.match(new RegExp(`^(?:${MEDIA_PREFIXES.join('|')})/[^/]+/([^/]+)/`));
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
  // Nightly. Cloudflare gives a scheduled Worker its own wall clock, so the
  // walk is not competing with a user waiting for a page.
  //
  // Three crons, three invocations, and the split is the whole point: the
  // subrequest allowance is per invocation, and all four projects in one
  // exceeded it — every night, before the manifest that would have said so.
  //
  //   08:30  publish the customer / job-number directories
  //   09:00  back up the heavy project (its streamed parts collection alone
  //          spends about thirty requests, so it gets an invocation to itself)
  //   09:20  back up the light projects, then merge the night and prune
  //
  // In that order so the night's dump includes the directories just written,
  // and so the finalize pass runs last with the light group's leftover
  // allowance. Free plan allows three cron triggers; this uses all three.
  async scheduled(event, env, ctx) {
    if (event.cron === '30 8 * * *') {
      ctx.waitUntil(
        publishDirectory(env, mintToken, { trigger: 'nightly' })
          .then((m) => console.log('publish', JSON.stringify(m.results)))
          .catch((err) => console.error('publish failed outright', err)));
      return;
    }

    if (event.cron === '0 9 * * *') {
      ctx.waitUntil(
        runBackup(env, mintToken, { only: NIGHTLY_GROUPS.heavy, trigger: 'nightly', group: 'heavy' })
          .then((m) => console.log('backup heavy', JSON.stringify(m.results)))
          .catch((err) => console.error('backup heavy failed outright', err)));
      return;
    }

    // The light group, then the merge. Sequential on purpose: finalize reads
    // the part files this run has just written.
    ctx.waitUntil((async () => {
      try {
        const m = await runBackup(env, mintToken, { only: NIGHTLY_GROUPS.light, trigger: 'nightly', group: 'light' });
        console.log('backup light', JSON.stringify(m.results));
      } catch (err) {
        // Still finalize: a merged manifest naming what is missing is the
        // thing somebody needs, and it is exactly what did not exist before.
        console.error('backup light failed outright', err);
      }
      try {
        const merged = await finalizeNightly(env, mintToken);
        console.log('backup finalize', JSON.stringify(merged.groups));
      } catch (err) {
        console.error('backup finalize failed outright', err);
      }
    })());
  },

  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGIN;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
    }

    const url = new URL(request.url);

    // --- POST /scan-receipt: read a receipt ----------------------------------
    // Same gate as /scan-weights, and for the same reason: it spends money per
    // call, so an unrecognised caller must not reach the model at all.
    if (url.pathname === '/scan-receipt') {
      if (request.method !== 'POST') return deny(405, 'Method not allowed', origin, allowed);
      if (!originAllowed(origin, (allowed || '').split(',').map((s) => s.trim()).filter(Boolean))) {
        return deny(403, 'Origin not permitted.', origin, allowed);
      }
      if (!env.ANTHROPIC_API_KEY) {
        return deny(503, 'Receipt reading is not configured yet.', origin, allowed);
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
      if (!mayScanReceipt(claims, env.FIREBASE_PROJECT_ID)) {
        return deny(403, 'Not permitted for this account.', origin, allowed);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return deny(400, 'Expected a JSON body.', origin, allowed);
      }

      try {
        const result = await scanReceipt(env, claims, body);
        console.log(`scan-receipt uid=${claims.sub} total=${result.total ?? 'null'}`);
        return new Response(JSON.stringify(result), {
          headers: { ...JSON_CT, ...corsHeaders(origin, allowed) },
        });
      } catch (err) {
        const status = err?.status || 502;
        if (status >= 500) console.error('scan-receipt error', err?.message, err?.cause || err);
        return deny(status, err?.message || 'Receipt reading failed.', origin, allowed);
      }
    }

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
    // --- Admin: create a customer login ---------------------------------
    //
    // Strictly admin-only, and verified here rather than inside accounts.js so
    // that every authorisation decision in this Worker is made in one file.
    // Anonymous sign-ins are refused explicitly: they carry a valid token and
    // no identity, which is exactly the shape that slips past a check written
    // as "is there a token?".
    // --- A plant managing its own logins ---------------------------------
    //
    // Open to the plant itself, not just JTI — but the customer is taken from
    // the caller's token and never from the request, so this cannot be pointed
    // at another plant. A JTI admin has no customerId of their own, so they use
    // /admin/create-login instead; falling through to "no customer" here would
    // be a confusing way to say that.
    // --- Billing ----------------------------------------------------------
    //
    // The webhook is FIRST and deliberately outside the token check: Stripe has
    // no Firebase session, and its request is authenticated by a signature over
    // the raw body instead. Reading the body must therefore happen before
    // anything else touches it.
    // --- POST /vision-ocr: read the balloon numbers off a parts drawing ------
    //
    // PartsViewer used to call Vision straight from the browser with a VITE_*
    // key, which Vite inlines into the bundle — the key was readable in the
    // deployed JavaScript without signing in. Same gate as /scan-weights: this
    // one spends money per call too.
    if (url.pathname === '/vision-ocr') {
      if (request.method !== 'POST') return deny(405, 'Method not allowed', origin, allowed);
      if (!originAllowed(origin, (allowed || '').split(',').map((s) => s.trim()).filter(Boolean))) {
        return deny(403, 'Origin not permitted.', origin, allowed);
      }
      if (!env.GOOGLE_VISION_API_KEY) {
        return deny(503, 'Drawing OCR is not configured yet.', origin, allowed);
      }

      const auth = request.headers.get('Authorization') || '';
      const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!jwt) return deny(401, 'Sign-in required.', origin, allowed);

      const visionProjects = (env.SCAN_PROJECT_IDS || env.FIREBASE_PROJECT_ID)
        .split(',').map((s) => s.trim()).filter(Boolean);

      let claims;
      try {
        claims = await verifyIdToken(jwt, visionProjects);
      } catch (err) {
        console.error('id token verify error', err);
        return deny(502, 'Upstream auth error', origin, allowed);
      }
      if (!claims) return deny(401, 'Session expired — sign in again.', origin, allowed);
      if (!mayUseVision(claims, env.FIREBASE_PROJECT_ID)) {
        return deny(403, 'Not permitted for this account.', origin, allowed);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return deny(400, 'Expected a JSON body.', origin, allowed);
      }

      try {
        const result = await visionOcr(env, claims, body);
        return new Response(JSON.stringify(result), {
          headers: { ...JSON_CT, ...corsHeaders(origin, allowed) },
        });
      } catch (err) {
        const status = err?.status || 502;
        if (status >= 500) console.error('vision-ocr error', err?.message, err?.cause || err);
        return deny(status, err?.message || 'Drawing OCR failed.', origin, allowed);
      }
    }

    if (url.pathname === '/billing/webhook') {
      if (request.method !== 'POST') return deny(405, 'Method not allowed', origin, allowed);
      const raw = await request.text();
      const token = await mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY, ACCOUNT_SCOPE);
      return billingWebhook(
        env, token, env.FIREBASE_PROJECT_ID, raw,
        request.headers.get('Stripe-Signature') || ''
      );
    }

    if (url.pathname.startsWith('/billing/')) {
      const auth = request.headers.get('Authorization') || '';
      const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!jwt) return deny(401, 'Sign-in required.', origin, allowed);

      let claims;
      try {
        claims = await verifyIdToken(jwt, [env.FIREBASE_PROJECT_ID]);
      } catch (err) {
        console.error('id token verify error', err);
        return deny(502, 'Upstream auth error', origin, allowed);
      }
      if (!claims) return deny(401, 'Session expired — sign in again.', origin, allowed);
      const customerId = typeof claims.customerId === 'string' ? claims.customerId : '';
      if (!customerId) return deny(403, 'This is for a plant login.', origin, allowed);

      const token = await mintToken(env.GCP_SA_EMAIL, env.GCP_SA_PRIVATE_KEY, ACCOUNT_SCOPE);
      const ws = env.WORKSPACE_UID || '';
      // Logins are counted by the same code that caps them, so the figure a
      // plant is shown and the figure enforced against it are one number.
      const listRes = await plantLogins(
        new Request(request.url, { method: 'GET' }), env, mintToken, customerId
      );
      const listed = await listRes.json().catch(() => ({ used: 0 }));
      const usedLogins = listed.used || 0;

      let res;
      if (url.pathname === '/billing/summary') {
        res = await billingSummary(env, token, env.FIREBASE_PROJECT_ID, ws, customerId, usedLogins);
      } else if (url.pathname === '/billing/checkout') {
        res = await billingCheckout(env, token, env.FIREBASE_PROJECT_ID, ws, customerId, usedLogins, origin || '');
      } else if (url.pathname === '/billing/portal') {
        res = await billingPortal(env, token, env.FIREBASE_PROJECT_ID, customerId, origin || '');
      } else {
        return deny(404, 'Not found', origin, allowed);
      }
      const out = new Response(res.body, res);
      Object.entries(corsHeaders(origin, allowed)).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    }

    if (url.pathname === '/account/logins') {
      if (!['GET', 'POST'].includes(request.method)) {
        return deny(405, 'Method not allowed', origin, allowed);
      }
      if (!env.GCP_SA_EMAIL || !env.GCP_SA_PRIVATE_KEY || !env.FIREBASE_PROJECT_ID) {
        return deny(503, 'Login management is not configured on the server.', origin, allowed);
      }

      const auth = request.headers.get('Authorization') || '';
      const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!jwt) return deny(401, 'Sign-in required.', origin, allowed);

      let claims;
      try {
        claims = await verifyIdToken(jwt, [env.FIREBASE_PROJECT_ID]);
      } catch (err) {
        console.error('id token verify error', err);
        return deny(502, 'Upstream auth error', origin, allowed);
      }
      if (!claims) return deny(401, 'Session expired — sign in again.', origin, allowed);
      if (claims.firebase?.sign_in_provider === 'anonymous') {
        return deny(403, 'Not permitted for this account.', origin, allowed);
      }
      const customerId = typeof claims.customerId === 'string' ? claims.customerId : '';
      if (!customerId) {
        return deny(403, 'This is for a plant login. JTI creates logins from the admin screen.', origin, allowed);
      }

      const res = await plantLogins(request, env, mintToken, customerId);
      const out = new Response(res.body, res);
      Object.entries(corsHeaders(origin, allowed)).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    }

    // --- GET /admin/backup-status ------------------------------------------
    // Whether the nightly job actually ran, without running it again.
    //
    // The manifests are already written next to the dumps; nothing could read
    // them, so the only way to see a backup happen was to set one off by hand,
    // which is the one thing that does not answer the question. Reads two
    // objects and returns them as they are: `latest-nightly.json`, which only
    // the cron writes, and `latest.json`, which the button also writes.
    if (url.pathname === '/admin/backup-status') {
      if (request.method !== 'GET') return deny(405, 'Method not allowed', origin, allowed);
      if (!env.GCP_SA_EMAIL || !env.GCP_SA_PRIVATE_KEY || !env.FIREBASE_PROJECT_ID) {
        return deny(503, 'Backups are not configured on the server.', origin, allowed);
      }

      const auth = request.headers.get('Authorization') || '';
      const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!jwt) return deny(401, 'Sign-in required.', origin, allowed);

      let claims;
      try {
        claims = await verifyIdToken(jwt, [env.FIREBASE_PROJECT_ID]);
      } catch (err) {
        console.error('id token verify error', err);
        return deny(502, 'Upstream auth error', origin, allowed);
      }
      if (!claims) return deny(401, 'Session expired — sign in again.', origin, allowed);
      if (claims.firebase?.sign_in_provider === 'anonymous' || claims.admin !== true) {
        return deny(403, 'Only a JTI admin can see the backup status.', origin, allowed);
      }

      const bucket = env.BACKUP_BUCKET || env.STORAGE_BUCKET;
      let body;
      try {
        const token = await getAccessToken(env);
        const [nightly, latest] = await Promise.all([
          getManifest(bucket, token, 'backups/latest-nightly.json'),
          getManifest(bucket, token, 'backups/latest.json'),
        ]);
        body = { bucket, nightly, latest, checkedAt: new Date().toISOString() };
      } catch (err) {
        // Answered as JSON so the page can say what went wrong rather than
        // showing nothing, which reads the same as "no backup".
        body = { bucket, error: String(err?.message || err), checkedAt: new Date().toISOString() };
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
      });
    }

    if (url.pathname === '/admin/create-login' || url.pathname === '/admin/sync-claims'
        || url.pathname === '/admin/logins' || url.pathname === '/admin/reset-password'
        // Runs the nightly backup now. Same admin gate as the rest: it reads
        // every collection in two projects, so it is not something an ordinary
        // signed-in caller should be able to set off.
        || url.pathname === '/admin/run-backup'
        // Republishes the customer / job-number directories now, without
        // waiting for the nightly cron. Same gate: it writes three projects.
        || url.pathname === '/admin/publish-directory') {
      if (request.method !== 'POST') return deny(405, 'Method not allowed', origin, allowed);
      if (!env.GCP_SA_EMAIL || !env.GCP_SA_PRIVATE_KEY || !env.FIREBASE_PROJECT_ID) {
        return deny(503, 'Account creation is not configured on the server.', origin, allowed);
      }

      const auth = request.headers.get('Authorization') || '';
      const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!jwt) return deny(401, 'Sign-in required.', origin, allowed);

      let claims;
      try {
        claims = await verifyIdToken(jwt, [env.FIREBASE_PROJECT_ID]);
      } catch (err) {
        console.error('id token verify error', err);
        return deny(502, 'Upstream auth error', origin, allowed);
      }
      if (!claims) return deny(401, 'Session expired — sign in again.', origin, allowed);
      if (claims.firebase?.sign_in_provider === 'anonymous' || claims.admin !== true) {
        return deny(403, 'Only a JTI admin can create logins.', origin, allowed);
      }

      if (url.pathname === '/admin/publish-directory') {
        let manifest;
        try {
          manifest = await publishDirectory(env, mintToken, { trigger: 'manual' });
        } catch (err) {
          // Answered as JSON, with CORS, so the reason survives the trip.
          manifest = { fatal: String(err?.message || err), results: [] };
        }
        // 200 either way: a run where one project failed is exactly what the
        // caller needs to see, and the manifest carries it.
        return new Response(JSON.stringify(manifest, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
        });
      }

      if (url.pathname === '/admin/run-backup') {
        // ?only=<project id> backs up one project. Every project in a single
        // request exceeded the Worker's subrequest allowance, and an exception
        // there is answered by Cloudflare with an error page carrying no CORS
        // headers — which the browser reports as "failed to fetch", telling you
        // nothing about what actually went wrong.
        const only = url.searchParams.get('only') || '';
        let manifest;
        try {
          manifest = await runBackup(env, mintToken, { only });
        } catch (err) {
          // Answered as JSON, with CORS, so the reason survives the trip.
          manifest = { fatal: String(err?.message || err), results: [] };
        }
        // The manifest is the answer whether or not everything worked — a run
        // where two projects failed is exactly what somebody needs to see, so
        // it comes back 200 with the detail rather than as an error.
        return new Response(JSON.stringify(manifest, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
        });
      }

      const handler = {
        '/admin/sync-claims': syncClaims,
        '/admin/logins': adminListLogins,
        '/admin/reset-password': adminResetPassword,
      }[url.pathname] || createLogin;
      const res = await handler(request, env, mintToken);
      const out = new Response(res.body, res);
      Object.entries(corsHeaders(origin, allowed)).forEach(([k, v]) => out.headers.set(k, v));
      return out;
    }

    // --- GET /shearers/{data,history}?token=… ---------------------------
    // Downtime data for a customer holding a share link. Origin-checked like
    // the other browser routes; the token is what actually authorises it.
    if (url.pathname.startsWith('/shearers/')) {
      if (request.method !== 'GET') return deny(405, 'Method not allowed', origin, allowed);
      if (!originAllowed(origin, (allowed || '').split(',').map((x) => x.trim()).filter(Boolean))) {
        return deny(403, 'Origin not permitted.', origin, allowed);
      }
      const which = url.pathname.slice('/shearers/'.length);
      const out = await shearersRead(request, env, mintToken, which);
      return new Response(out.body, {
        status: out.status,
        headers: {
          'Content-Type': out.json ? 'application/json' : 'text/plain; charset=utf-8',
          // Short, because the viewer polls: long enough to spare the database
          // a request per viewer per few seconds, short enough that a customer
          // watching a shift sees it move.
          ...(out.status === 200 ? { 'Cache-Control': 'private, max-age=20' } : {}),
          ...corsHeaders(origin, allowed),
        },
      });
    }

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

        // Which machines a named plant has. Non-admin, unlike /parts/catalog:
        // it answers only for the customers the caller names, so it cannot be
        // used to enumerate the catalog.
        if (url.pathname === '/parts/folders') {
          const names = (url.searchParams.get('customers') || '')
            .split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8);
          if (names.length === 0) return deny(400, 'Missing customers.', origin, allowed);
          const data = await foldersForCustomers(env, token, names);
          const headers = new Headers({ ...JSON_CT, ...corsHeaders(origin, allowed) });
          headers.set('Cache-Control', 'private, max-age=300');
          return new Response(JSON.stringify({ customers: data }), { headers });
        }

        // The drawings that make up one machine's manual.
        if (url.pathname === '/parts/diagrams') {
          const customer = (url.searchParams.get('customer') || '').trim();
          const folder = (url.searchParams.get('folder') || '').trim();
          if (!customer || !folder) {
            return deny(400, 'Missing customer or folder.', origin, allowed);
          }
          const diagrams = await diagramsForFolder(env, token, customer, folder);
          const headers = new Headers({ ...JSON_CT, ...corsHeaders(origin, allowed) });
          headers.set('Cache-Control', 'private, max-age=300');
          return new Response(JSON.stringify({ customer, folder, diagrams }), { headers });
        }

        // One diagram's hotspots, for highlighting the replaced part.
        if (url.pathname === '/parts/diagram') {
          const id = (url.searchParams.get('id') || '').trim();
          if (!id) return deny(400, 'Missing diagram id.', origin, allowed);
          const d = await diagramMeta(env, token, id);
          if (!d) return deny(404, 'That diagram no longer exists.', origin, allowed);
          const headers = new Headers({ ...JSON_CT, ...corsHeaders(origin, allowed) });
          headers.set('Cache-Control', 'private, max-age=300');
          return new Response(JSON.stringify(d), { headers });
        }

        // The drawing itself, streamed from the parts bucket so the browser
        // never holds a durable public URL to it.
        if (url.pathname === '/parts/diagram-image') {
          const id = (url.searchParams.get('id') || '').trim();
          if (!id) return deny(400, 'Missing diagram id.', origin, allowed);
          const upstream = await diagramImage(env, token, id);
          if (!upstream) return deny(404, 'That diagram no longer exists.', origin, allowed);
          if (!upstream.ok) {
            return deny(upstream.status === 404 ? 404 : 502, 'Drawing not available.', origin, allowed);
          }
          const headers = new Headers(corsHeaders(origin, allowed));
          for (const h of ['Content-Type', 'Content-Length', 'ETag']) {
            const v = upstream.headers.get(h);
            if (v) headers.set(h, v);
          }
          headers.set('Cache-Control', 'private, max-age=600');
          headers.set('X-Content-Type-Options', 'nosniff');
          return new Response(upstream.body, { status: 200, headers });
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
          visionOcr: !!env.GOOGLE_VISION_API_KEY,
          parts: partsConfigured(env),
          billing: billingConfigured(env),
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
