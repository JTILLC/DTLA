// Weigher-screen reader (POST /scan-weights)
// ---------------------------------------------------------------------------
// Turns a photo of an Ishida CCW "Manual Adjustment" screen into head/weight
// pairs so an operator can fill 14–20 current-weight fields by taking one
// picture instead of typing every number off the panel.
//
// Why a vision model rather than OCR
// ----------------------------------
// The head numbers are CIRCLED glyphs (①②③…) drawn into the hopper graphics,
// which classic OCR either drops or reads as (1) / 0 / O. And the layout is a
// ring, not a table, so there is no row structure to key off.
//
// Why position can never be trusted
// ---------------------------------
// Head 1 is not always at 12 o'clock — the same line can show it at 3 o'clock
// on the next screen. So the model is told to anchor on the circled numeral and
// read the weight inside THAT hopper's region, and is explicitly forbidden from
// inferring a head number from ring position or reading order. The centre of
// the screen is a dispersion table that shows a circled number next to a value
// like "0g"; that decoy is called out by name in the prompt.
//
// The expected head count is deliberately NOT sent to the model. Telling it
// "this line has 14 heads" invites padding a partial read up to 14 with
// invented numbers. The caller compares the count itself and warns the operator.
//
// Nothing here writes anything. The result pre-fills fields for review; the
// operator still presses save.
//
// Secret (wrangler secret put): ANTHROPIC_API_KEY
import Anthropic from '@anthropic-ai/sdk';

// A compressed screen photo from the client is ~150–400KB; base64 inflates ~4/3.
// Anything much past this is not a phone snapshot of a control panel.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// Best-effort spend guard. This is per-isolate, so it is a speed bump rather
// than a quota — the real gate is the claims check in the handler, which keeps
// anonymous sessions out entirely.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 8;
const recent = new Map();   // uid -> number[] (timestamps)

const rateLimited = (uid) => {
  const now = Date.now();
  const hits = (recent.get(uid) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) { recent.set(uid, hits); return true; }
  hits.push(now);
  recent.set(uid, hits);
  if (recent.size > 500) recent.clear();     // crude ceiling on isolate memory
  return false;
};

const SYSTEM = `You read weight values off a photograph of an Ishida multihead weigher (CCW) control screen.

The screen draws one hopper region per weigh head, arranged in a ring. Inside each hopper region there is a CIRCLED head number (a digit drawn inside a circle: ①, ②, ③ …) and that head's current weight in grams.

How to read it:
- Find each circled head number, then read the weight that sits INSIDE THAT SAME hopper region. The number and the weight are paired by region.
- Ring position carries no meaning. Head 1 may be at 12 o'clock, at 3 o'clock, or anywhere else, and the arrangement changes between screens. Never infer a head number from where it sits, from clockwise reading order, or from the order in which you happen to process the regions. Every head number you return must come from a circled numeral you actually read.
- Ignore the centre of the screen. The centre panel is a dispersion/summary table and commonly shows a circled number beside a value such as "0g" that is NOT a head weight.
- Ignore totals, target/span weights, counters, timers, and any status text outside the hopper ring.

Reporting rules:
- Return one entry per circled head number you can read, with the weight exactly as displayed, keeping the decimal (e.g. 1000.5, not 1000 or 1001).
- If a hopper's number or its weight is unreadable — glare, blur, cropped edge, an obscuring hand — omit that head entirely rather than guessing, and say which ones in notes.
- Set confident to false for any value you did read but are not certain of.
- Do NOT invent heads to complete a sequence. If only 12 hoppers are readable, return 12. Never pad.
- If the image is not a weigher screen at all, return an empty heads array and say so in notes.`;

const SCHEMA = {
  type: 'object',
  properties: {
    heads: {
      type: 'array',
      description: 'One entry per circled head number legible on the screen.',
      items: {
        type: 'object',
        properties: {
          head: { type: 'integer', description: 'The circled head number as printed.' },
          weight: { type: 'number', description: 'That hopper\'s displayed weight, decimals kept.' },
          confident: { type: 'boolean', description: 'False if the reading is uncertain.' },
        },
        required: ['head', 'weight', 'confident'],
        additionalProperties: false,
      },
    },
    unit: {
      type: 'string',
      enum: ['g', 'oz', 'unknown'],
      description: 'Unit shown on screen.',
    },
    notes: {
      type: 'string',
      description: 'Anything the operator should know: heads skipped and why, or why nothing was read.',
    },
  },
  required: ['heads', 'unit', 'notes'],
  additionalProperties: false,
};

// Callers must be a provisioned user — this endpoint costs money per call.
//
// Anonymous sessions are refused outright wherever they come from: the CCW
// project alone has ~50 of them, and an anonymous token is free to mint.
//
// Beyond that the rule is per project. CCW is multi-tenant, so a caller must
// carry the same claims storage.rules uses. The Shearers app is a separate,
// single-plant project with email/password sign-in only — there is no anonymous
// or self-serve account to gate against, so a verified user is sufficient.
export const mayScan = (claims, ccwProjectId) => {
  if (claims?.firebase?.sign_in_provider === 'anonymous') return false;
  if (claims?.aud === ccwProjectId) {
    return claims.admin === true || !!claims.customerId;
  }
  return true;   // any other project only reaches here if it is allow-listed
};

export async function scanWeights(env, claims, body) {
  if (rateLimited(claims.sub)) {
    const err = new Error('Too many scans in the last minute — give it a moment.');
    err.status = 429;
    throw err;
  }

  const b64 = typeof body?.image === 'string' ? body.image.replace(/^data:[^,]+,/, '') : '';
  if (!b64) {
    const err = new Error('No image supplied.');
    err.status = 400;
    throw err;
  }
  // base64 length -> byte count, without materialising the buffer.
  if (Math.floor((b64.length * 3) / 4) > MAX_IMAGE_BYTES) {
    const err = new Error('Image too large — retake it at a smaller size.');
    err.status = 413;
    throw err;
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let response;
  try {
    response = await createRead(client, b64);
  } catch (err) {
    throw asOperatorError(err);
  }
  return readResult(response, claims);
}

// The SDK's message for an API failure is the raw JSON body — fine in a log,
// useless on a plant floor. Translate the cases an operator can act on, and
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
    return out('Screen reading is unavailable — the JTI Anthropic account is out of credit.', 503);
  }
  if (status === 401 || status === 403) {
    return out('Screen reading is misconfigured — the API key was rejected.', 503);
  }
  if (status === 429) {
    return out('Screen reading is busy right now — try again in a moment.', 429);
  }
  if (status === 529 || (status >= 500 && status < 600)) {
    return out('The reading service is temporarily unavailable — try again shortly.', 503);
  }
  return out('Could not read the screen — try again, or enter the weights manually.', 502);
}

const createRead = (client, b64) =>
  client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'high',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: b64 },
          },
          {
            type: 'text',
            text: 'Read the head numbers and their current weights off this weigher screen.',
          },
        ],
      },
    ],
  });

function readResult(response, claims) {
  // A refusal returns HTTP 200 with an empty/partial content array, so this has
  // to be checked before touching content — otherwise it surfaces as a confusing
  // parse error instead of an honest message.
  if (response.stop_reason === 'refusal') {
    const err = new Error('The reader declined this image. Try a plain photo of the weigher screen.');
    err.status = 422;
    throw err;
  }
  if (response.stop_reason === 'max_tokens') {
    const err = new Error('The reader ran out of room before finishing. Try a tighter crop of the screen.');
    err.status = 502;
    throw err;
  }

  const text = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const err = new Error('Could not read the screen. Try again with less glare.');
    err.status = 502;
    throw err;
  }

  const u = response.usage || {};
  console.log(
    `scan-weights uid=${claims.sub} heads=${parsed?.heads?.length ?? 0} ` +
    `in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0}`
  );

  return {
    heads: Array.isArray(parsed.heads) ? parsed.heads : [],
    unit: parsed.unit || 'unknown',
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  };
}
