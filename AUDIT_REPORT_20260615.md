# Webapp Audit — 2026-06-15

Scope: the 7 deployed apps. Source-only backups created as `<App>_backup_20260615.tgz`
(excludes node_modules / dist / .git). Backups verified.

| App | Deploy | Backup |
|-----|--------|--------|
| CCWISSUESGitHub | jti-ccwlog | CCWISSUESGitHub_backup_20260615.tgz |
| JTIInventory | jtiinventory | JTIInventory_backup_20260615.tgz |
| JTIUnified | jtiapp | JTIUnified_backup_20260615.tgz |
| PartsViewerCustomer | jti-ipm | PartsViewerCustomer_backup_20260615.tgz |
| ServiceQuoteWA | jtiservicequote | ServiceQuoteWA_backup_20260615.tgz |
| ShearersClaude | shearersjtidowntime | ShearersClaude_backup_20260615.tgz |
| TS GitHub | jti-ts3 | TS_GitHub_backup_20260615.tgz |

This is an **audit only** — no app code was changed.

---

## Cross-cutting themes (appear in most apps)

1. **Security: data access rules too open.** Multiple backends are world-readable or
   any-authed-user-readable:
   - CCW Issues `firestore.rules`: `user_files/**` is `allow read: if true` — every
     customer's visits/profile publicly readable.
   - TS GitHub `firestore.rules`: `if request.auth != null` — any logged-in user can
     read/edit/delete **all** customers' financial timesheets.
   - Shearers `database.rules.json`: logger data + share tokens world-readable; the
     "share token" is cosmetic.
   - ServiceQuote / JTIInventory: no rules file in repo — must be verified server-side.
   This is the single highest-priority category.

2. **Native `alert()`/`confirm()`/`prompt()` for primary flows** in every app, despite
   most having a styled toast/modal system already built. Blocking + jarring on mobile.

3. **No memoization** — large list/render functions recompute (and re-sort) on every
   keystroke; row components not wrapped in `React.memo`. Most apps have `useMemo` count = 0.

4. **God-component files** (App.jsx 1,700–4,300 lines) holding Firestore CRUD, PDF export,
   and all UI inline. Hard to maintain.

5. **Dead code & committed backup files** inside `src/` (e.g. `App.jsx copy`, `*.backup_*`,
   unused Supabase clients, unused offline-queue infra).

6. **Leftover `console.log`** in production paths, some leaking customer/quote data.

---

## Per-app top findings

### CCWISSUESGitHub (jti-ccwlog)
- **High security** — `firestore.rules`: remove `allow read: if true` on `user_files/**`;
  scope public reads to `shared_visits`; add `userId` ownership check on `shared_visits` writes.
- **High correctness** — `ShareModal.jsx:197` uses `useState(() => {...}, [deps])` where
  `useEffect` was intended; share-list refresh is silently broken.
- **High efficiency** — visits loaded 3 ways (per-customer snapshot + post-mutation
  `loadVisits()` + a "load ALL visits for ALL customers" effect at App.jsx:1841). Redundant
  full-DB reads; the load-all effect clobbers the live subscription. Remove redundant paths.
- **Bug** — `exportLineHistoryToPDF` (App.jsx:309/311) references undefined `logoUrl`;
  multi-page history PDFs throw `ReferenceError`.
- Dead offline infra (`offlineQueue.js`/`syncManager.js` have zero callers); `netlify-cli`
  is a prod dependency; `@supabase/supabase-js` unused.

### JTIInventory (jtiinventory)
- **High correctness** — qty +/- (`App.jsx:204-237`) reads stale `part.qty`; rapid taps lose
  increments. Use Firestore `increment(delta)`.
- **Medium** — CRUD helpers (delete/rename/qty) not wrapped in try/catch → failures are silent.
- **Medium** — no loading state before first snapshot → false "No parts yet" flash.
- Rename doesn't de-dupe against existing names; search box is live but inert on
  Categories/Customers tabs.

### JTIUnified (jtiapp)
- **High correctness** — `CalendarView.jsx` renders `<X>` / `<Edit2>` but never imports them;
  opening the day-detail modal crashes to the ErrorBoundary. One-line import fix.
- **High** — search has no staleness guard (out-of-order async overwrites results);
  `searchUnified` re-`JSON.stringify`s the whole corpus every search.
- **Medium UX** — production "Debug: Data Load Status (remove after debugging)" banner visible.
- **Security** — `window.open(url,'_blank')` without `noopener,noreferrer` (tabnabbing).
- Inline sub-components recreated each render (remount + state reset on each keystroke).

### PartsViewerCustomer (jti-ipm)
- **High UX** — no pinch/zoom/pan on diagrams; dense diagrams with 44px hotspots nearly
  unusable on phones.
- **High correctness** — `handleDeleteCustomer`/`handleDeleteFolder` (lines 835-896) use stale
  `globalOrderList` in a loop and delete by the wrong key — only the last diagram is removed
  and order items are never cleaned up.
- **High security** — hardcoded shared password `'JTI2022'` in client bundle gates cloud-load +
  deletes; `.env` (with `VITE_GOOGLE_VISION_API_KEY`) is NOT in `.gitignore`.
- Zero memoization; diagram grouping re-sorts on every keystroke/toggle.

### ServiceQuoteWA (jtiservicequote)
- **High correctness** — floating-point money accumulation; sum per-item costs in integer cents.
- **Likely real bug** — manually-added customers (written to `service_quotes_customers`) never
  appear in the "Select Customer" dropdown, which reads from `service_quotes` instead.
- **Medium** — `importJSON` trusts file shape; a file missing `items` crashes the app.
- **Dead code** — `src/App.jsx copy` (248 lines); `collectionGroup` imported but unused while
  `loadCustomers`/`loadSavedQuotes` do N+1 reads.
- No `firestore.rules` in repo — verify auth requirement server-side.

### ShearersClaude (shearersjtidowntime)
- **High correctness** — `SharedViewer.jsx` calls `useLocation()` after early returns
  (conditional hook) → React can crash on the public share page.
- **High correctness** — `Dashboard.jsx` uses CommonJS `require()` in an ESM/Vite module; the
  DatesContext path is silently always-broken.
- **High efficiency** — `Navigation.jsx` polls localStorage every 2s forever → constant
  app-wide re-renders. Feed `data` via props/context instead.
- **High security** — RTDB rules make logger data + share tokens world-readable.
- **Bug** — logger DatePicker uses `toISOString()` (UTC) in an Arizona app → off-by-one day.
- Many committed `* copy` / backup files in `src/`.

### TS GitHub (jti-ts3)
- **High security** — `firestore.rules` `if request.auth != null` exposes all customers'
  financial data to any logged-in user. Add owner-scoping / admin allowlist.
- **High correctness** — three divergent hours/overtime calculators (calculations.js,
  SavedEntriesTable, TimeEntryForm) disagree; on-screen table can differ from the invoice.
  Cross-midnight spans yield negative hours.
- **Medium bug** — `deleteCustomer`/`renameCustomer` use v8 `doc.ref.delete()` under the v9
  SDK → deletes/renames likely fail silently.
- **Dead code** — `CustomerInfo`, `TravelCharges`, `ServiceReport`, `Invoice`,
  `ServiceReportPagebackup`, unused `dataUtils.js` / `supabase.js` (~1,000 lines).

---

## Recommended order of work

1. **Security pass (all apps)** — tighten Firestore / RTDB rules; move the Google Vision key
   out of the client / restrict it; add `.env` to `.gitignore`. Highest risk, mostly config.
2. **One-line crash fixes** — JTIUnified missing `X`/`Edit2` import; Shearers conditional
   `useLocation` + `require()`; CCW `logoUrl` ReferenceError; CCW ShareModal `useState`→`useEffect`.
3. **Correctness bugs** — TS GitHub calc consolidation + v8 delete API; ServiceQuote money
   rounding + customer-dropdown source + import validation; PartsViewer delete-handler;
   JTIInventory qty increment race.
4. **Efficiency** — remove Shearers 2s poll & CCW redundant visit loads; add `useMemo`/
   `React.memo` to hot lists across apps.
5. **Cleanup** — delete committed `* copy`/backup files and dead modules; strip debug logs;
   move `netlify-cli` to devDeps; remove unused Supabase clients.
6. **UX polish** — replace native `alert/confirm/prompt` with existing modal systems; add
   loading states; PartsViewer pinch-zoom.
