# CCW media broker

Serves customer-facing photos and service-report PDFs so that **media access
expires with the share link**.

## Why

`getDownloadURL()` returns a tokenized link that **bypasses Storage security
rules by design** — it is meant to be publicly shareable. So today:

- a leaked photo URL is readable forever, by anyone;
- revoking a share link does **not** revoke file URLs already handed out;
- tightening the Storage read rule does **not** invalidate existing links.

Share expiry is enforced properly in Firestore but had no equivalent for media.
This Worker is that equivalent. It re-checks the share on every request and
streams the bytes itself, so the browser never holds a durable public URL.

Neatest part: the Worker reads `shared_visits/{token}` **unauthenticated**. The
Firestore rule already says `allow get: if notExpired(...)`, so an expired or
revoked share returns 403 and the media request dies with it. The expiry logic
lives in exactly one place and cannot drift.

## Deploy

```bash
cd media-worker
npx wrangler secret put GCP_SA_EMAIL        # client_email from the service account JSON
npx wrangler secret put GCP_SA_PRIVATE_KEY  # private_key from the same file, PEM including BEGIN/END
npx wrangler deploy
```

You will need a service account key again (Firebase Console → Project settings →
Service accounts → Generate new private key). Only the two fields above are
needed; do not commit the file. The Worker requests the
`devstorage.read_only` scope, so it can read objects and nothing else.

Then point the viewer at it — set `MEDIA_BROKER_BASE` in
`CCWCustomerViewer/src/config/media.js` to the deployed URL and redeploy:

```js
export const MEDIA_BROKER_BASE = 'https://ccw-media.<subdomain>.workers.dev';
```

While that constant is empty the viewer renders stored public URLs exactly as
before, so deploying the Worker changes nothing until you flip it.

## Verifying

```bash
curl -sI https://ccw-media.<subdomain>.workers.dev/health          # -> 200 ok
curl -sI ".../m/<validShareToken>/issue-photos/<ws>/<cid>/<...>.jpg"  # -> 200 image/jpeg
curl -sI ".../m/<revokedToken>/issue-photos/..."                     # -> 403
curl -sI ".../m/<validShareToken>/issue-photos/<ws>/<OTHER_cid>/..." # -> 403
```

That last one is the important one: it proves a valid share token is not a key
to another tenant's media.

## `POST /scan-weights` — reading a weigher screen

Second job, same Worker: an operator photographs the Ishida CCW screen and the
span-adjust page fills the current-weight fields from it, instead of them typing
14–20 numbers standing at the machine.

It shares this Worker because it needs exactly the same gate — a Firebase ID
token checked against the same custom claims. A second Worker would mean a
second copy of that logic to keep in step.

```bash
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Until that secret is set the route returns **503** with a plain message and
everything else is unaffected.

Request: `{"image": "<base64 jpeg>"}` with `Authorization: Bearer <idToken>`.
Response: `{"heads": [{"head": 1, "weight": 1000.5, "confident": true}, …],
"unit": "g", "notes": ""}`.

Three things about it are load-bearing:

- **Anchored on the circled numeral, never on position.** Head 1 can sit at 12
  o'clock on one line and 3 o'clock on the next, so nothing may be inferred from
  ring position or reading order. The prompt says this explicitly.
- **The expected head count is not sent to the model.** Telling it "this line has
  14 heads" invites padding a 12-head read up to 14 with invented numbers. The
  client compares counts itself and warns.
- **It pre-fills, it never saves.** Scanned values land in editable fields marked
  with a blue border; the operator still presses the log button.

Cost control is the claims check — anonymous Firebase sessions hold a valid ID
token but no claims, and are refused before the model is called. There is also a
per-isolate 8/minute throttle, which is a speed bump rather than a quota.

## What this does and does not close

Deploying this Worker and flipping `MEDIA_BROKER_BASE` means **new** page views
go through the broker. It does **not** by itself close the hole, because every
URL already stored in a visit document still works.

Fully closing it takes three stages, and only the last is destructive:

1. **Broker live, viewer using it.** Additive; old URLs still work as a fallback.
   **DONE.**
2. **Make objects private.** *Not* simply "stop calling `getDownloadURL()`" — an
   earlier version of this document said that and it was wrong. Firebase creates
   the download token **automatically at upload**, so a public URL exists whether
   or not the app ever asks for it. Making a file private means REMOVING its
   `firebaseStorageDownloadTokens` metadata.
   That breaks the field apps, which render photos from those same public URLs,
   so it needs an authenticated media path first:
   - `/a/<path>` with a Firebase ID token — **DONE**, deployed, authorises off
     the same custom claims as `storage.rules`.
   - Field apps fetch through it and render via blob URLs. `<img src>` cannot
     send an `Authorization` header, so the image must be fetched in JS and
     turned into an object URL (the pattern already used for queued photos in
     `IssuePhotos`). **NOT STARTED.**
   - Strip the token after each upload, and sweep existing objects.
     **NOT STARTED.**
3. **Deny direct Storage reads** (`allow read: if false`). Only safe once every
   client reads through the broker. Invalidates the `url` field in every existing
   visit doc.

Stage 1 done. Stage 2 part-done (broker side ready, client side not). Stage 3
not started.
