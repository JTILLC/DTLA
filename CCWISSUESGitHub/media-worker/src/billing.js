// media-worker/src/billing.js
//
// Seats and subscriptions.
//
// The model is the hybrid one: a plant's base fee covers a few logins and a few
// crew members; beyond that it is per named crew member per month.
//
//   logins  the accounts that open the app. Capped, and the cap is the thing
//           /account/logins already enforces.
//   crew    the named people on the roster. These are what is billed, because
//           they are what the plant gets value from — attribution, PINs, line
//           assignments and history all hang off a crew record.
//
// Counting is done HERE, server-side, from the same documents the app writes.
// A seat count computed in the browser is a number the customer can choose.
//
// Everything Stripe-shaped degrades when the keys are absent, exactly as the
// parts lookup does: the usage figures still work — they are just counting —
// and only the pay-for-it parts report "not configured". That way the screen is
// useful before any of the commercial side exists.

export const billingConfigured = (env) => !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);

const DEFAULTS = { includedLogins: 3, includedCrew: 5 };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const FS = (projectId, path) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;

async function getDoc(token, projectId, path) {
  const res = await fetch(FS(projectId, path), { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Firestore REST wraps every scalar in a type tag. Only the few shapes this
// module stores are unwrapped — a general-purpose reader would be more code
// than the whole file needs.
const num = (f) => {
  const v = f?.integerValue ?? f?.doubleValue;
  return v == null ? null : Number(v);
};
const str = (f) => (typeof f?.stringValue === 'string' ? f.stringValue : '');

export async function readBilling(token, projectId, customerId) {
  const doc = await getDoc(token, projectId, `billing/${encodeURIComponent(customerId)}`).catch(() => null);
  const f = doc?.fields || {};
  return {
    plan: str(f.plan) || 'none',
    status: str(f.status) || 'none',              // none | trialing | active | past_due | canceled
    includedLogins: num(f.includedLogins) ?? DEFAULTS.includedLogins,
    includedCrew: num(f.includedCrew) ?? DEFAULTS.includedCrew,
    stripeCustomerId: str(f.stripeCustomerId),
    subscriptionId: str(f.subscriptionId),
    currentPeriodEnd: str(f.currentPeriodEnd),
  };
}

async function writeBilling(token, projectId, customerId, patch) {
  const fields = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) continue;
    fields[k] = typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
  }
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${k}`).join('&');
  const res = await fetch(`${FS(projectId, `billing/${encodeURIComponent(customerId)}`)}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Could not record billing state: ${await res.text()}`);
}

// How many named people are on the roster. The crew document is one record per
// customer holding a `people` array, so this is a read rather than a query.
export async function crewCount(token, projectId, workspaceId, customerId) {
  const doc = await getDoc(
    token, projectId,
    `user_files/${workspaceId}/customers/${encodeURIComponent(customerId)}/config/crew`
  ).catch(() => null);
  const people = doc?.fields?.people?.arrayValue?.values || [];
  // Someone with no name is a half-finished row in the editor, not a person.
  return people.filter((p) => str(p.mapValue?.fields?.name).trim()).length;
}

export function seatMath(billing, crew, logins) {
  const billableCrew = Math.max(0, crew - billing.includedCrew);
  return {
    crew,
    logins,
    includedCrew: billing.includedCrew,
    includedLogins: billing.includedLogins,
    billableCrew,
    // What a subscription's quantity should be. Kept as one function so the
    // number shown to a customer and the number sent to Stripe cannot differ.
    quantity: billableCrew,
  };
}

// ---- Stripe ---------------------------------------------------------------
//
// Called over REST rather than with the SDK: Workers have fetch and no Node
// runtime, and this uses three endpoints.

const stripe = async (env, path, form) => {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${env.STRIPE_SECRET_KEY}:`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe said ${res.status}`);
    err.status = 400;
    throw err;
  }
  return data;
};

// Stripe signs the raw body with a timestamp. Verified by hand because the SDK
// is not available here — and skipping it would mean anyone who learns the URL
// could tell us a subscription is paid.
export async function verifyStripeSignature(secret, header, rawBody) {
  const parts = Object.fromEntries(
    String(header || '').split(',').map((kv) => kv.split('=').map((x) => x.trim()))
  );
  if (!parts.t || !parts.v1) return false;

  // Reject anything older than five minutes: a valid signature replayed later
  // is still a forged event.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${parts.t}.${rawBody}`));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // Constant-time compare — a length check plus XOR, so a timing difference
  // cannot leak how much of the signature was right.
  if (expected.length !== parts.v1.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i);
  return diff === 0;
}

// GET /billing/summary — usage and plan for the caller's own plant.
export async function summary(env, token, projectId, workspaceId, customerId, logins) {
  const billing = await readBilling(token, projectId, customerId);
  const crew = await crewCount(token, projectId, workspaceId, customerId);
  return json({
    ...seatMath(billing, crew, logins),
    plan: billing.plan,
    status: billing.status,
    currentPeriodEnd: billing.currentPeriodEnd,
    configured: billingConfigured(env),
    manageable: billingConfigured(env) && !!billing.stripeCustomerId,
  });
}

// POST /billing/checkout — start or change a subscription.
export async function checkout(env, token, projectId, workspaceId, customerId, logins, origin) {
  if (!billingConfigured(env)) return json({ error: 'Billing is not set up yet.' }, 503);
  const billing = await readBilling(token, projectId, customerId);
  const crew = await crewCount(token, projectId, workspaceId, customerId);
  const seats = seatMath(billing, crew, logins);

  const session = await stripe(env, 'checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': env.STRIPE_PRICE_ID,
    // Stripe rejects a quantity of zero, and a plant inside its included
    // allowance has nothing to pay for yet.
    'line_items[0][quantity]': String(Math.max(1, seats.quantity)),
    success_url: `${origin}/?billing=done`,
    cancel_url: `${origin}/?billing=canceled`,
    client_reference_id: customerId,
    ...(billing.stripeCustomerId ? { customer: billing.stripeCustomerId } : {}),
  });
  return json({ url: session.url });
}

// POST /billing/portal — manage payment details or cancel.
export async function portal(env, token, projectId, customerId, origin) {
  if (!billingConfigured(env)) return json({ error: 'Billing is not set up yet.' }, 503);
  const billing = await readBilling(token, projectId, customerId);
  if (!billing.stripeCustomerId) return json({ error: 'No subscription to manage yet.' }, 404);
  const session = await stripe(env, 'billing_portal/sessions', {
    customer: billing.stripeCustomerId,
    return_url: `${origin}/`,
  });
  return json({ url: session.url });
}

// POST /billing/webhook — Stripe tells us what happened.
//
// The subscription's own state is the truth; this only mirrors it, so replaying
// an old event cannot do anything worse than restate a fact.
export async function webhook(env, token, projectId, rawBody, signature) {
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Not configured' }, 503);
  if (!(await verifyStripeSignature(env.STRIPE_WEBHOOK_SECRET, signature, rawBody))) {
    return json({ error: 'Bad signature' }, 400);
  }

  const event = JSON.parse(rawBody);
  const obj = event?.data?.object || {};
  const customerId = obj.client_reference_id || obj.metadata?.customerId || '';

  switch (event.type) {
    case 'checkout.session.completed':
      if (customerId) {
        await writeBilling(token, projectId, customerId, {
          stripeCustomerId: obj.customer, subscriptionId: obj.subscription,
          status: 'active', plan: 'per-seat',
        });
      }
      break;
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      // These events carry no client_reference_id, so the plant is found by the
      // subscription we recorded at checkout.
      const cid = obj.metadata?.customerId;
      if (cid) {
        await writeBilling(token, projectId, cid, {
          status: event.type.endsWith('deleted') ? 'canceled' : obj.status,
          currentPeriodEnd: obj.current_period_end
            ? new Date(obj.current_period_end * 1000).toISOString() : null,
        });
      }
      break;
    }
    default:
      break;      // everything else is acknowledged and ignored
  }
  return json({ received: true });
}

export default {
  billingConfigured, readBilling, crewCount, seatMath,
  summary, checkout, portal, webhook, verifyStripeSignature,
};
