# Multi-tenant pilot — setup & how it works

This fork of CCW Issues adds **roles** so a customer can log their own equipment
issues while you keep a single master view across all customers. The original
app in `../CCWISSUESGitHub` is untouched.

## How it works

- **Same Firebase backend** as the original app (project `downtimelogger-a96fb`),
  same data. This fork is just a second frontend that adds role scoping.
- All data lives under **one shared workspace root** — your uid,
  `WORKSPACE_UID` in `src/config/constants.js`. Every data/storage path uses it
  instead of the logged-in user's uid, so a customer login writes into the
  shared workspace (into *their* customer folder), not a separate silo.
- A user's role comes from a Firestore doc **`app_roles/{uid}`**:
  - `{ admin: true }` → sees/edits **every** customer (you, the owner).
  - `{ customerId: "<cid>" }` → locked to **one** customer; the picker is hidden
    and only their customer loads.
  - no doc → "Account not set up yet" screen (no access).
- Firestore **rules** (`firestore.rules`) enforce writes: admins anywhere; a
  customer only within `user_files/<workspace>/customers/<their cid>/**`.
  Reads stay public for the pilot (the customer viewer/share-links rely on it).

## ⚠️ Deploy order matters (shared backend)

The rules are **backend-wide** — deploying them affects BOTH this fork and the
original app. If you deploy the new rules before your admin role doc exists,
the original app loses write access. **Do it in this order:**

### 1. Create YOUR admin role doc (do this FIRST)
Firebase console → Firestore → collection `app_roles` → add document:
- **Document ID:** `tgezUokMZ1PO7iEDbLbj2U7Uwbx1` (your uid = `WORKSPACE_UID`)
- **Field:** `admin` (boolean) = `true`

### 2. Deploy the rules (affects both apps)
From this folder:
```
npx firebase deploy --only firestore:rules --project downtimelogger-a96fb
```
Confirm the original app still saves (you're admin, so it will).

### 3. Create a pilot customer login
- Firebase console → Authentication → Add user (email + password) → copy its **UID**.
- The customer must map to an existing customer record. Find the customer's
  `cid`: it's the doc id under `user_files/<workspace>/customers/`. (Create the
  customer in the original app first if it doesn't exist.)
- Firestore → `app_roles` → add document:
  - **Document ID:** the customer user's **UID**
  - **Field:** `customerId` (string) = the customer's `cid`

### 4. Deploy this fork (later, when ready to test on a device)
It needs its own hosting URL added to Firebase Auth → **Authorized domains**.
Suggested: a new Cloudflare Pages project, e.g. `jti-issues-mt`. (Not done yet —
you can test locally with `npm run dev` first.)

## Test checklist
- Log in as **you** → see all customers, master view unchanged.
- Log in as the **customer** → locked to their customer, can add/edit issues,
  autosave works; confirm signatures + factory layout still save.
- Confirm the customer **cannot** reach another customer's data.

## Known pilot gaps (by design, for now)
- **Reads aren't isolated** — a customer can't *edit* others' data but the data
  isn't hidden on read. Revisit before onboarding more customers.
- **Storage writes** are still "any signed-in user" (photos/reports). Low risk
  with a trusted pilot; tighten with read isolation.
- **RedZone** per-customer credentials come in a later phase.
