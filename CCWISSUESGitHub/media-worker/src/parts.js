// Parts catalog lookup (GET /parts/catalog, GET /parts/parts)
// ---------------------------------------------------------------------------
// Lets the board/parts log confirm a replaced part against the machine's actual
// parts manual instead of taking free text on trust.
//
// The catalog lives in a DIFFERENT Firebase project (the Parts Viewer app,
// jobs-data-17ee4) from the CCW apps, so the browser cannot read it — a second
// client-side Firebase app would mean a second login on a second project. The
// Worker reads it with its own service account, which is the same shape as
// everything else here.
//
// How a part is scoped to a machine
// ---------------------------------
// The catalog organises as customer -> folder -> diagram, and A FOLDER IS ONE
// MACHINE. It carries no model or serial number, so those cannot be the join.
// Instead each CCW line is BOUND to (partsCustomer, folder) once by JTI, and
// lookups only ever ask for that folder. A binding fails loudly — a line with
// none shows "no manual linked" — whereas matching on model/serial strings
// would fail silently on a typo and hand someone the wrong machine's parts.
//
// Secrets (wrangler secret put):
//   PARTS_SA_EMAIL, PARTS_SA_PRIVATE_KEY   service account on the parts project
// Var: PARTS_PROJECT_ID
// Without them both routes return 503 and nothing else changes.

const COLLECTION = 'parts-viewer-diagrams';

const str = (f) => (f && typeof f.stringValue === 'string' ? f.stringValue : '');

// Firestore REST returns every scalar wrapped in a type tag; unwrap the two
// shapes that appear in partsData.
const scalar = (f) => {
  if (!f) return '';
  if (typeof f.stringValue === 'string') return f.stringValue;
  if (typeof f.integerValue !== 'undefined') return String(f.integerValue);
  if (typeof f.doubleValue !== 'undefined') return String(f.doubleValue);
  return '';
};

async function runQuery(env, token, structuredQuery) {
  const url =
    `https://firestore.googleapis.com/v1/projects/${env.PARTS_PROJECT_ID}` +
    `/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) {
    const err = new Error(`parts query failed: ${res.status} ${await res.text()}`);
    err.status = 502;
    throw err;
  }
  const rows = await res.json();
  return (Array.isArray(rows) ? rows : []).filter((r) => r.document).map((r) => r.document);
}

export const partsConfigured = (env) =>
  !!env.PARTS_SA_EMAIL && !!env.PARTS_SA_PRIVATE_KEY && !!env.PARTS_PROJECT_ID;

// The customer -> folder tree, for the JTI screen that binds a line to a
// machine. Only metadata is fetched — `select` keeps partsData (by far the
// bulk of a diagram) out of the response.
export async function catalog(env, token) {
  const docs = await runQuery(env, token, {
    from: [{ collectionId: COLLECTION }],
    select: {
      fields: [{ fieldPath: 'customer' }, { fieldPath: 'folder' }, { fieldPath: 'name' }],
    },
  });

  const byCustomer = new Map();
  for (const d of docs) {
    const f = d.fields || {};
    const customer = str(f.customer).trim();
    const folder = str(f.folder).trim();
    if (!customer || !folder) continue;          // unfiled diagrams can't be bound to
    if (!byCustomer.has(customer)) byCustomer.set(customer, new Map());
    const folders = byCustomer.get(customer);
    folders.set(folder, (folders.get(folder) || 0) + 1);
  }

  return [...byCustomer.entries()]
    .map(([customer, folders]) => ({
      customer,
      folders: [...folders.entries()]
        .map(([folder, diagrams]) => ({ folder, diagrams }))
        .sort((a, b) => a.folder.localeCompare(b.folder, undefined, { numeric: true })),
    }))
    .sort((a, b) => a.customer.localeCompare(b.customer));
}

// Every part in one machine's manual, flattened across that folder's diagrams.
//
// The map key is the diagram's balloon/item number; `partCode` is the real part
// number. Both are returned because an operator may read either off the machine
// or the drawing, and searching only one would look broken.
export async function partsForFolder(env, token, customer, folder) {
  const docs = await runQuery(env, token, {
    from: [{ collectionId: COLLECTION }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'customer' }, op: 'EQUAL', value: { stringValue: customer } } },
          { fieldFilter: { field: { fieldPath: 'folder' }, op: 'EQUAL', value: { stringValue: folder } } },
        ],
      },
    },
  });

  const out = [];
  const seen = new Set();
  for (const d of docs) {
    const f = d.fields || {};
    const diagramId = (d.name || '').split('/').pop();
    const diagramName = str(f.name) || 'Untitled';
    const entries = f.partsData?.mapValue?.fields || {};
    for (const [itemNo, v] of Object.entries(entries)) {
      const pf = v?.mapValue?.fields || {};
      const partCode = scalar(pf.partCode).trim();
      const partName = scalar(pf.partName).trim();
      // Same part can appear on several drawings of one machine; list it once.
      const key = `${partCode}|${itemNo}|${partName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        itemNo,
        partCode,
        partName,
        qty: scalar(pf.qty),
        diagramId,
        diagramName,
      });
    }
  }

  out.sort((a, b) =>
    (a.partCode || a.itemNo).localeCompare(b.partCode || b.itemNo, undefined, { numeric: true })
  );
  return out;
}
