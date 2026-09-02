// RCU settings-screen reader (POST /scan-rcu-screen)
// ---------------------------------------------------------------------------
// Turns a photo of an Ishida CCW Remote Control Unit into the label/value pairs
// printed on it, so a "centerline" — the document telling a customer what their
// settings should be — can be built from a photograph instead of transcribed by
// hand off the panel.
//
// This is NOT the weigher-screen reader (weights.js). That one reads current
// weights off a ring of hoppers. This one reads a settings page: a grid of
// rectangular fields, each holding one value and its label.
//
// Why a vision model rather than OCR
// ----------------------------------
// OCR returns a bag of strings with boxes and no idea which string is a label,
// which is its value, which radio button is the filled one, or which fields are
// grayed out. All four of those are the difference between a correct centerline
// and a wrong one.
//
// The two things that will silently corrupt a read
// ------------------------------------------------
// 1. Pairing. Read top-to-bottom in reading order and every value pairs with
//    the label of the field above it — an off-by-one down the whole screen,
//    where each value is individually plausible and every one is attached to
//    the wrong name. Pairing is by ENCLOSING BOX, never by reading order. (The
//    RCU's own text exports have the same trap; see tools/parse_export.py in
//    the centerline project.)
//
// 2. Which of the two lines in a box is the value. It is NOT a fixed position:
//    the RCU has two field styles and they are INVERTED.
//
//        gray button        green dropdown panel
//        ------------       --------------------
//        1:1Mix     <- value    Filter No.  <- label
//        Section Parameter       0          <- value
//        Number     <- label     [ribbed bar with a down triangle]
//
//    A rule of "the value is on top" reads every dropdown backwards, reporting
//    the setting's name as its value. What actually holds across BOTH styles is
//    color: the value is printed in BLUE, the label in BLACK. That is what the
//    prompt keys on, with position given only as a secondary hint.
//
// Why the expected fields are never sent
// --------------------------------------
// Same rule as the weigher scanner: telling the model which fields a screen
// ought to have invites it to fill the ones it cannot actually see. The caller
// knows what it expected and can compare; the model only ever reports what it
// read.
//
// Nothing here writes anything, and nothing here is authoritative. Values
// pre-fill a form for review, and the operator confirms them before they reach
// a document that goes to a customer.
//
// Secret (wrangler secret put): ANTHROPIC_API_KEY
import Anthropic from '@anthropic-ai/sdk';

// A cropped screen photo is ~200-600KB; base64 inflates ~4/3. Well past a
// phone snapshot of a control panel is not what this route is for.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Best-effort spend guard, per isolate — a speed bump, not a quota. The real
// gate is the claims check in the handler. A centerline is a handful of screens
// photographed in one visit, so this is deliberately looser than the weigher
// scanner's eight.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 12;
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

const SYSTEM = `You read settings off a photograph of an Ishida CCW multihead weigher's Remote Control Unit (RCU) touchscreen.

The screen is a grid of rectangular fields. Each field holds ONE setting: its current value and, separately, the name of the setting.

RULE 1 — a value pairs with a label ONLY when the two sit inside the SAME bordered field.
Never pair by reading order, and never pair a value with the label nearest above it — that is the label of the field above, and following reading order shifts every setting on the screen onto the wrong name.

RULE 2 — inside a field, THE VALUE IS THE BLUE TEXT AND THE LABEL IS THE BLACK TEXT.
Do not use position to tell them apart. The RCU has two field styles and they are the other way up from each other:
- A gray button prints the value on top and its name underneath:
      1:1Mix                     <- value, blue
      Section Parameter Number   <- label, black
- A pale green panel with a ribbed bar and a small down-triangle beneath it is a DROPDOWN, and prints its name on top and the value underneath:
      Filter No.                 <- label, black
      0                          <- value, blue
      [ribbed bar with a down-triangle]
Assuming the value is always the upper line reads every dropdown backwards and reports the setting's name as its value. Go by color.

RULE 3 — SELECTION INVERTS THE COLORS. A field or a table row that is currently selected is drawn with a solid blue background and pale text, instead of dark text on gray or green. On a selected row the value is the PALE text, not the blue. Blue as a background means "this one is selected"; blue as text means "this is a value". Do not report the highlight itself as a value, and do not skip a selected row because its text is not blue.

Reading each kind of field:
- Plain value fields: report the value exactly as displayed, including any unit shown in the same string (90.0g, 80wpm, 400msec, 99.0%, 1:1Mix, 2:Slave).
- Dropdowns (the green panel with the ribbed bar and down-triangle): report the option currently shown, which is the selected one. The ribbed bar itself is a control, not a value.
- Radio buttons / option pairs: a field may offer choices such as "400g / 800g" or "Off / On", one of which is filled in or highlighted to show it is selected. Report ONLY the selected option as the value. If you cannot tell which is selected, omit the field and say so in notes.
- Grayed-out or dimmed fields: these are disabled and their contents are not in force. Report them with enabled=false, and put the grayed text in value if you can read it.
- Rows in a list or table (for example a list of filters, each with its own setting): report each row as its own field, using the row's own name as the label.
- Pop-up panels: pressing a field can open a small panel over the screen offering further options, one of them filled to show it is selected. If a pop-up is open, report the selected option as a field, using the pop-up's own heading as the label, and say in notes that a pop-up was covering part of the screen. Never report a setting whose field the pop-up is sitting on top of — you cannot see it, and a value read through a covering panel is a guess.

What is NOT a setting, and must not be reported:
- The title bar at the top (screen name, preset identifier such as "C1" or "C1+C2", the language selector, status lamps, the date and time).
- The tab strip that selects which page is shown.
- The fixed bar along the bottom (HOME, the message area, Power, Stop, Start).
- Buttons that perform an action rather than hold a value (Output, Exit, Cancel, PRT-DEBUG).
Report the screen's title and the active tab separately, in their own output properties.

Reporting rules:
- Copy each label EXACTLY as printed, including its spacing, abbreviation and punctuation ("Disch.Priority Count", "AUTO ZERO TOL", "Extended Upper Limit Dump Cycle"). Do not expand, tidy or translate a label — the caller matches on the printed text.
- Copy each value exactly as displayed. Keep decimals and trailing zeros (90.0, not 90). Keep the unit if it is shown.
- If a label or its value is unreadable — glare, blur, a cropped edge, an obscuring hand — omit that field entirely rather than guessing, and say which in notes.
- Set confident to false for any field you did read but are not certain of.
- Do NOT report a setting you cannot see because you expect the screen to have it. Report only what is legible in this image. A short, correct list is the goal; a complete-looking list containing one invented value is a failure.
- If the image is not an RCU settings screen at all, return an empty fields array and say so in notes.`;

const SCHEMA = {
  type: 'object',
  properties: {
    screenTitle: {
      type: 'string',
      description: 'The screen name from the title bar, as printed, or "" if unreadable.',
    },
    activeTab: {
      type: 'string',
      description: 'The selected tab in the tab strip, as printed, or "" if there is none.',
    },
    fields: {
      type: 'array',
      description: 'One entry per setting field legible on the screen.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'The setting name exactly as printed.' },
          value: { type: 'string', description: 'The value exactly as displayed, unit included.' },
          enabled: { type: 'boolean', description: 'False when the field is grayed out / disabled.' },
          confident: { type: 'boolean', description: 'False if the reading is uncertain.' },
        },
        required: ['label', 'value', 'enabled', 'confident'],
        additionalProperties: false,
      },
    },
    notes: {
      type: 'string',
      description: 'Anything the engineer should know: fields skipped and why, or why nothing was read.',
    },
  },
  required: ['screenTitle', 'activeTab', 'fields', 'notes'],
  additionalProperties: false,
};

export async function scanRcuScreen(env, claims, body) {
  if (rateLimited(claims.sub)) {
    const err = new Error('Too many screen reads in the last minute — give it a moment.');
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
    const err = new Error('Image too large — crop to the screen, or retake it smaller.');
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
// useless on a plant floor. Translate the cases an engineer can act on, and
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
  return out('Could not read the screen — try again, or type the settings in manually.', 502);
}

const createRead = (client, b64, mediaType = 'image/jpeg') =>
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
            source: { type: 'base64', media_type: mediaType, data: b64 },
          },
          {
            type: 'text',
            text: 'Read the settings off this RCU screen. Pair each value with the label '
                + 'inside the SAME bordered field, and remember the value is the BLUE '
                + 'text — on a gray button it sits above its label, on a green dropdown '
                + 'below it.',
          },
        ],
      },
    ],
  });

export function readResult(response, claims) {
  // A refusal returns HTTP 200 with an empty/partial content array, so this has
  // to be checked before touching content — otherwise it surfaces as a confusing
  // parse error instead of an honest message.
  if (response.stop_reason === 'refusal') {
    const err = new Error('The reader declined this image. Try a plain photo of the RCU screen.');
    err.status = 422;
    throw err;
  }
  if (response.stop_reason === 'max_tokens') {
    const err = new Error('The reader ran out of room before finishing. Try one screen at a time.');
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

  // Shape defensively: a malformed field would otherwise reach the centerline
  // form as `undefined` and print as a blank setting rather than a missing one.
  const fields = (Array.isArray(parsed.fields) ? parsed.fields : [])
    .filter((f) => f && typeof f.label === 'string' && f.label.trim())
    .map((f) => ({
      label: f.label.trim(),
      value: typeof f.value === 'string' ? f.value.trim() : '',
      enabled: f.enabled !== false,
      confident: f.confident === true,
    }));

  const u = response.usage || {};
  console.log(
    `scan-rcu-screen uid=${claims.sub} fields=${fields.length} ` +
    `in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0}`
  );

  return {
    screenTitle: typeof parsed.screenTitle === 'string' ? parsed.screenTitle.trim() : '',
    activeTab: typeof parsed.activeTab === 'string' ? parsed.activeTab.trim() : '',
    fields,
    notes: typeof parsed.notes === 'string' ? parsed.notes : '',
  };
}
