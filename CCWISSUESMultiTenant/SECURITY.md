# Security model and deploy order

One Firebase project (`downtimelogger-a96fb`) backs three apps: this one, the
multi-tenant fork (`CCWISSUESMultiTenant`), and the login-less customer viewer
(`CCWCustomerViewer`). **Rules are project-wide** — deploying them from any of
these repos changes behaviour for all three immediately, independently of which
Pages build is live.

## Deploy order (getting this wrong breaks uploads)

```
1. npm i -D firebase-admin
2. GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/sync-claims.mjs --dry-run
3. GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/sync-claims.mjs
4. Confirm claims took effect (sign out and back in, or wait ~1h for token refresh)
5. npx firebase deploy --only storage --project downtimelogger-a96fb
```

**Do not deploy `storage.rules` before step 3 completes.** The new write rules
authorise against custom claims, and until the sync runs nobody has any — so
every photo and service-report upload fails for every user.

`firestore.rules` has no such dependency and can be deployed at any time:

```
npx firebase deploy --only firestore:rules --project downtimelogger-a96fb
```

Get `sa.json` from Firebase Console → Project settings → Service accounts →
"Generate new private key". **Never commit it.**

## Who can read what (Firestore)

Enforced in `firestore.rules`:

| Data | Who can read |
|---|---|
| `user_files/{ws}/customers/{cid}/**` | admins; that customer's own login; the public viewer *while an unexpired share marker exists* |
| `app_roles/{uid}` | that user, or an admin |
| `customer_secrets/{cid}` | admins and that customer's login only — deliberately **not** readable via a share link |
| `shared_visits/{token}` | anyone with the token, until it expires. Listing is admin-only, so tokens can't be enumerated |
| everything else | admins |

## Share links

A share link is a **bearer credential to that customer's whole visit history**,
not just the visit it was created from — the viewer's visit dropdown depends on
that. Links therefore expire (default 90 days, chosen per link in ShareModal).

Two things enforce it:

- `shared_visits/{token}` — denied once `expiresAt` passes.
- `shared_customers/{cid}` — the marker that opens public read for the customer.
  `refreshCustomerShareMarker()` keeps its `expiresAt` at the **latest** expiry
  among that customer's live links, and deletes it when none remain.

`expiresAt: null` means never expires. Links created before expiry existed are
grandfathered and keep working until revoked — review them periodically; the
share list flags them amber as "Never expires".

## Storage

Writes are scoped by custom claims (`admin`, `customerId`) compared against the
customer-id segment of the upload path. Storage rules **cannot read Firestore**,
so `app_roles` is invisible to them — that is the entire reason claims exist
here, and why `scripts/sync-claims.mjs` must be re-run whenever a role changes.

### Known limitation: Storage reads are public

`allow read: if true` on all paths. The login-less viewer needs to render photos
and has no credential to check, and Storage rules can't consult the share-expiry
state that guards Firestore. So:

- **A photo or PDF URL that leaks stays readable, and is not covered by share
  expiry.** Download URLs carry an unguessable token, so treat these files as
  "secret by URL", not access-controlled.
- Revoking a share does **not** revoke previously-issued file URLs.

**A media broker now exists to close this** — see `media-worker/`. It re-checks
the share on every request and streams the bytes, so media access expires with
the link. It is written but NOT yet deployed, and deploying it alone is not
enough: every URL already stored in a visit document keeps working until its
download token is revoked per object. See `media-worker/README.md` for the
three-stage migration. Stage 1 (broker + viewer wiring, behind an empty
`MEDIA_BROKER_BASE` flag) is done; stages 2 and 3 are not started.

## Not yet covered

- **No audit trail.** Nothing records who changed a head's status or when.
- **Concurrent edits are last-write-wins** on the whole visit document.
- **Claims sync is manual.** A role changed in `app_roles` has no effect on
  Storage access until `sync-claims.mjs` is re-run.
- **Rules are not automatically tested.** They compile-check on deploy, but
  there is no test suite asserting who can read what. Running the Firestore
  emulator needs a Java runtime (`brew install openjdk`), after which
  `@firebase/rules-unit-testing` could cover the table above.
