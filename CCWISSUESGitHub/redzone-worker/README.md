# CCW Issues → RedZone push broker

Small Cloudflare Worker that lets operators push a head's issues from the CCW
Issues app into **RedZone** (QAD Redzone) as a maintenance **work order**, with
one tap. The Worker exists because RedZone's API uses secret OAuth credentials
that must never live in the browser.

```
CCW Issues (Send to RedZone)  →  this Worker (holds RedZone secrets)  →  RedZone REST API
```

## Status: scaffolding

The plumbing is real (routing, auth gate, CORS, validation, idempotent
create-vs-update, error handling). Two functions are **stubbed / TODO** because
they need details only available from the RedZone Developer Hub (behind login)
and per-tenant OAuth credentials that aren't provisioned yet:

- `getRedzoneToken()` — the real OAuth token URL + params.
- `upsertWorkOrder()` / `mapToRedzoneWorkOrder()` — the real work-order endpoint
  path and field mapping.

While unconfigured, the Worker returns **501** for those, and the app shows a
clear "not configured yet" state (with a payload preview) instead of the button
silently failing.

## Going live (once RedZone API access is confirmed)

1. Fill in `REDZONE_API_BASE` / `REDZONE_TOKEN_URL` in `wrangler.toml` and set
   secrets:
   ```
   npx wrangler secret put REDZONE_CLIENT_ID
   npx wrangler secret put REDZONE_CLIENT_SECRET
   npx wrangler secret put CCW_CLIENT_KEY      # optional; must match the app
   ```
2. Adjust the two `TODO` functions in `src/index.js` to RedZone's real schema.
3. Deploy: `npm i && npx wrangler deploy`.
4. Put the deployed URL + `/push` into the app:
   `src/config/constants.js` → `REDZONE_CONFIG.pushEndpoint` (and `clientKey` if
   you set `CCW_CLIENT_KEY`). Rebuild + redeploy CCW Issues.

## Request contract

`POST /push` with the JSON built by `buildRedzonePayload()` in
`src/components/RedZoneSync.jsx`. Key fields:

- `externalRef` — stable `customerId:visitId:lineId:head-N`, for idempotent dedupe.
- `existingWorkOrderId` — present when re-sending, triggers update instead of create.
- `summary`, `customer`, `line`, `head`, `issues[]` (each with `photos[]` URLs).

Response: `{ "workOrderId": "...", "workOrderUrl": "..." | null }`.
```
