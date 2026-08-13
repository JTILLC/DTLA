// Receipt reader (POST /scan-receipt)
// ---------------------------------------------------------------------------
// Turns a photo of a receipt into { vendor, date, total } so the job packet's
// expense fields can be pre-filled instead of typed off a crumpled slip in a
// van.
//
// Why the total is the hard part
// ------------------------------
// A receipt shows several numbers that all look like the answer: subtotal, tax,
// tip, change given, cash tendered, and often a card authorisation amount that
// matches the total by coincidence. The one we want is the amount actually
// charged. So the prompt names the decoys and asks for the grand total —
// tax included, change and tendered amounts excluded.
//
// Why nothing is guessed
// ----------------------
// Every field may come back null. A receipt with a torn corner should produce
// "I could not read the total" and leave the operator typing one number, not a
// confident wrong figure that flows into an invoice and gets sent to a
// customer. A number nobody checked is worse than a blank box, because a blank
// box is obviously blank.
//
// Nothing here writes anything. The result pre-fills fields for review.
//
// Secret (wrangler secret put): ANTHROPIC_API_KEY  — shared with /scan-weights
import Anthropic from '@anthropic-ai/sdk';

// Phone photos of receipts, after client-side compression, are well under this.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// Best-effort spend guard, per isolate. The real gate is the claims check in
// the handler; this stops one stuck client burning the account.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
const recent = new Map();

const rateLimited = (uid) => {
  const now = Date.now();
  const hits = (recent.get(uid) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) { recent.set(uid, hits); return true; }
  hits.push(now);
  recent.set(uid, hits);
  if (recent.size > 500) recent.clear();
  return false;
};

const SYSTEM = `You read a photograph of a purchase receipt and report three things: the vendor, the date, and the total actually charged.

THE TOTAL is the single most important field, and receipts are full of numbers that resemble it. Report the grand total the customer was charged — the figure that includes tax.

Do NOT report any of these as the total:
- the subtotal or "net" amount before tax
- the tax or VAT line on its own
- "cash tendered", "amount given", or "change due"
- an itemised line that happens to be the largest
- a loyalty balance, points total, or account balance carried forward

If the receipt shows a card authorisation or "amount charged" that agrees with the grand total, that is the total. If they disagree, prefer the printed grand total.

THE VENDOR is the trading name at the top of the receipt — the shop or supplier. Not the parent company, not the street, not a strapline.

THE DATE is the transaction date. Return it as YYYY-MM-DD. If the receipt shows a two-digit year, resolve it to the 2000s. If only a time is legible and no date, return null.

RULES:
- Return null for anything you cannot actually read. Do not infer, estimate, or reconstruct a figure from the arithmetic of other lines.
- Never return a total you are not confident is the charged amount. A null is useful; a wrong number is not, because it will be billed to a customer.
- Report the number only: no currency symbol, no thousands separators. "1,234.56" is 1234.56.
- If the image is not a receipt at all, return nulls throughout and say so in notes.`;

const SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: ['string', 'null'], description: 'Trading name at the top of the receipt, or null.' },
    date: { type: ['string', 'null'], description: 'Transaction date as YYYY-MM-DD, or null.' },
    total: { type: ['number', 'null'], description: 'Grand total charged, tax included. Null if not confidently readable.' },
    currency: { type: ['string', 'null'], description: 'ISO code if shown or obvious, else null.' },
    notes: { type: ['string', 'null'], description: 'Anything the operator should check, e.g. "total partly obscured".' },
  },
  required: ['vendor', 'date', 'total', 'currency', 'notes'],
  additionalProperties: false,
};

/** Same permission rule as the weigher-screen reader; kept separate so the two can diverge. */
export const mayScanReceipt = (claims, ccwProjectId) => {
  if (!claims) return false;
  // Anonymous sessions never reach a paid model.
  if (claims.firebase?.sign_in_provider === 'anonymous') return false;
  return Boolean(claims.sub);
};

/** Media type from a data URI, falling back to JPEG — phone cameras produce it. */
const mediaTypeOf = (raw) => {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp|gif));/i.exec(String(raw || ''));
  if (!m) return 'image/jpeg';
  const t = m[1].toLowerCase();
  return t === 'image/jpg' ? 'image/jpeg' : t;
};

export async function scanReceipt(env, claims, body) {
  if (rateLimited(claims.sub)) {
    const err = new Error('Too many scans in the last minute — give it a moment.');
    err.status = 429;
    throw err;
  }

  const raw = typeof body?.image === 'string' ? body.image : '';
  const mediaType = mediaTypeOf(raw);
  const b64 = raw.replace(/^data:[^,]+,/, '');
  if (!b64) {
    const err = new Error('No image supplied.');
    err.status = 400;
    throw err;
  }
  if (Math.floor((b64.length * 3) / 4) > MAX_IMAGE_BYTES) {
    const err = new Error('Image too large — retake it at a smaller size.');
    err.status = 413;
    throw err;
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let response;
  try {
    response = await createRead(client, b64, mediaType);
  } catch (err) {
    throw asOperatorError(err);
  }
  return readResult(response);
}

// The SDK's message for an API failure is the raw JSON body — fine in a log,
// useless to somebody holding a receipt. Translate what can be acted on and
// keep the original on the error for the Worker log.
function asOperatorError(err) {
  const raw = err?.message || String(err);
  const status = err?.status;
  const out = (msg, s) => {
    const e = new Error(msg);
    e.status = s;
    e.cause = raw;
    return e;
  };

  if (/credit balance/i.test(raw)) {
    return out('Receipt reading is unavailable — the JTI Anthropic account is out of credit.', 503);
  }
  if (status === 401 || status === 403) {
    return out('Receipt reading is misconfigured — the API key was rejected.', 503);
  }
  if (status === 429) {
    return out('Receipt reading is busy right now — try again in a moment.', 429);
  }
  if (status === 529 || (status >= 500 && status < 600)) {
    return out('The reading service is temporarily unavailable — try again shortly.', 503);
  }
  return out('Could not read the receipt — try again, or type the amount in.', 502);
}

const createRead = (client, b64, mediaType) =>
  client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 2000,
    thinking: { type: 'adaptive' },
    output_config: {
      // A receipt is a small image and the decision is short, but the figure
      // ends up on an invoice, so this is not the place to economise.
      effort: 'high',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
          { type: 'text', text: 'Read the vendor, the date, and the total charged from this receipt.' },
        ],
      },
    ],
  });

function readResult(response) {
  // A refusal returns HTTP 200 with an empty or partial content array, so it
  // has to be checked before touching content — otherwise it surfaces as a
  // confusing parse error rather than an honest message.
  if (response.stop_reason === 'refusal') {
    const err = new Error('The reader declined this image. Try a plain photo of the receipt.');
    err.status = 422;
    throw err;
  }
  if (response.stop_reason === 'max_tokens') {
    const err = new Error('The reader ran out of room before finishing. Try a tighter crop.');
    err.status = 502;
    throw err;
  }

  const block = (response.content || []).find((c) => c.type === 'text');
  let parsed;
  try {
    parsed = JSON.parse(block?.text ?? '');
  } catch {
    const err = new Error('Could not read the receipt — try again, or type the amount in.');
    err.status = 502;
    err.cause = block?.text;
    throw err;
  }

  const total = typeof parsed.total === 'number' && Number.isFinite(parsed.total) ? parsed.total : null;
  return {
    vendor: parsed.vendor || null,
    date: parsed.date || null,
    // Negative or absurd values mean it read the wrong line; a null sends
    // somebody to the receipt rather than onto an invoice.
    total: total !== null && total > 0 && total < 1_000_000 ? total : null,
    currency: parsed.currency || null,
    notes: parsed.notes || null,
  };
}
