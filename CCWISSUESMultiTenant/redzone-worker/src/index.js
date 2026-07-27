// CCW Issues → RedZone maintenance push broker (Cloudflare Worker)
// ---------------------------------------------------------------------------
// The CCW Issues browser app POSTs a head's issues here; this Worker holds the
// RedZone OAuth credentials (as Worker secrets — NEVER in the browser),
// authenticates to RedZone, and creates or updates a maintenance work order.
//
// STATUS: scaffolding. Two functions are stubbed and marked TODO — getRedzoneToken()
// and upsertWorkOrder() — because the exact RedZone token URL, work-order endpoint,
// and payload schema come from the RedZone Developer Hub (behind their login) and
// per-tenant OAuth credentials that aren't provisioned yet. Everything else
// (routing, auth gate, CORS, request validation, response shape) is real.
//
// Configure via `wrangler secret put` (see wrangler.toml comments):
//   REDZONE_TOKEN_URL, REDZONE_API_BASE, REDZONE_CLIENT_ID, REDZONE_CLIENT_SECRET
//   CCW_CLIENT_KEY   (optional shared secret the app sends as x-ccw-key)
//   ALLOWED_ORIGIN   (e.g. https://jti-issues.pages.dev)

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-ccw-key',
  'Access-Control-Max-Age': '86400'
});

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) }
  });

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(allowedOrigin) });
    }
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/push') {
      return json({ error: 'Not found' }, 404, allowedOrigin);
    }

    // Gate who may call the Worker (defense in depth on top of CORS).
    if (env.CCW_CLIENT_KEY && request.headers.get('x-ccw-key') !== env.CCW_CLIENT_KEY) {
      return json({ error: 'Unauthorized' }, 401, allowedOrigin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, allowedOrigin);
    }
    if (!payload?.externalRef || !payload?.summary) {
      return json({ error: 'Missing required fields (externalRef, summary)' }, 400, allowedOrigin);
    }

    try {
      const token = await getRedzoneToken(env);
      const result = await upsertWorkOrder(env, token, payload);
      return json(
        { workOrderId: result.workOrderId, workOrderUrl: result.workOrderUrl || null },
        200,
        allowedOrigin
      );
    } catch (err) {
      // 501 while stubbed so the app shows a clear "not implemented yet" rather
      // than a silent failure.
      const status = err.code === 'NOT_IMPLEMENTED' ? 501 : 502;
      return json({ error: err.message || 'RedZone push failed' }, status, allowedOrigin);
    }
  }
};

// --- RedZone OAuth (client-credentials) -----------------------------------
// TODO: replace with the real token endpoint + params from the RedZone
// Developer Hub. Typical OAuth2 client-credentials shape shown below.
async function getRedzoneToken(env) {
  if (!env.REDZONE_TOKEN_URL || !env.REDZONE_CLIENT_ID || !env.REDZONE_CLIENT_SECRET) {
    throw Object.assign(new Error('RedZone credentials not configured on the Worker'), { code: 'NOT_IMPLEMENTED' });
  }
  const res = await fetch(env.REDZONE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.REDZONE_CLIENT_ID,
      client_secret: env.REDZONE_CLIENT_SECRET
      // scope: env.REDZONE_SCOPE, // add if RedZone requires a scope
    })
  });
  if (!res.ok) throw new Error(`RedZone token request failed (${res.status})`);
  const data = await res.json();
  return data.access_token;
}

// --- Create or update a RedZone work order --------------------------------
// TODO: replace the endpoint path and body mapping with the real RedZone
// work-order (maintenance order) API from the Developer Hub. The mapping from
// our payload → RedZone fields is the part to confirm with their schema.
async function upsertWorkOrder(env, token, payload) {
  if (!env.REDZONE_API_BASE) {
    throw Object.assign(new Error('RedZone API base not configured on the Worker'), { code: 'NOT_IMPLEMENTED' });
  }

  const body = mapToRedzoneWorkOrder(payload);
  const isUpdate = !!payload.existingWorkOrderId;

  // TODO confirm real paths, e.g. POST /maintenance/work-orders and
  // PATCH /maintenance/work-orders/{id}
  const endpoint = isUpdate
    ? `${env.REDZONE_API_BASE}/maintenance/work-orders/${payload.existingWorkOrderId}`
    : `${env.REDZONE_API_BASE}/maintenance/work-orders`;

  const res = await fetch(endpoint, {
    method: isUpdate ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`RedZone work-order ${isUpdate ? 'update' : 'create'} failed (${res.status})`);
  const data = await res.json();
  return { workOrderId: data.id || payload.existingWorkOrderId, workOrderUrl: data.url };
}

// Pure mapping — easy to unit test and adjust once the RedZone schema is known.
function mapToRedzoneWorkOrder(payload) {
  const description = [
    `Customer: ${payload.customer}`,
    `Line: ${payload.line.title}${payload.line.serialNumber ? ` (S/N ${payload.line.serialNumber})` : ''}`,
    `Head ${payload.head.number} — status: ${payload.head.status}`,
    payload.head.notes ? `Head notes: ${payload.head.notes}` : null,
    '',
    'Issues:',
    ...payload.issues.map(i =>
      `• ${i.type} [${i.status}]${i.notes ? ` — ${i.notes}` : ''}${i.photos.length ? ` (${i.photos.length} photo)` : ''}`
    ),
    ...payload.issues.flatMap(i => i.photos).map(u => `Photo: ${u}`)
  ].filter(Boolean).join('\n');

  return {
    // TODO: map to RedZone's real field names (asset/machine id, title,
    // description, priority, source). externalRef enables idempotent dedupe.
    title: payload.summary,
    description,
    externalReference: payload.externalRef,
    source: 'CCW Issues'
  };
}
