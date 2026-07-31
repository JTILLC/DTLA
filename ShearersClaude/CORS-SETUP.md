# Storage CORS — why the daily PDF could not include photos

> **Status: applied 2026-07-31.** The bucket now carries the policy in
> `cors.json` and photos embed in the report. Kept as the record of what was
> wrong and how it was fixed, and in case the bucket is ever recreated.

## Symptom

Photos display fine everywhere in the app, but the daily PDF shows
`Photos — 0 of N included` and lists each one as
`the photo opens but the download carries no permission to copy it (CORS)`.

## Cause

The PDF has to put the actual image bytes in the file — it cannot reference a
URL. Reading those bytes requires a cross-origin request, and the bucket
`shearers-4c4b4.firebasestorage.app` has no CORS configuration, so the browser
refuses to hand the pixels to the report.

Displaying a photo does **not** need CORS, which is why nothing else looked
broken.

> Diagnostic trap: `curl`ing the bucket shows `access-control-allow-origin: *`
> and appears to prove CORS is fine. That header comes from Firebase's API layer
> on **403/404 error responses only**. A successful object download is served
> differently and respects the bucket's own config. Testing error paths proves
> nothing.

## Fix (one time, ~2 minutes)

Photos uploaded from 2026-07-31 onward no longer need this — a thumbnail is
stored at upload time and the report uses it directly. This is only needed to
recover photos taken **before** that.

Easiest route is Google Cloud Shell, which is already authenticated and needs
nothing installed:

1. Open <https://console.cloud.google.com/> and pick project **shearers-4c4b4**
2. Click the **Cloud Shell** icon (`>_`, top right)
3. Check what is set now — expect an error or empty, meaning no config:

   ```
   gcloud storage buckets describe gs://shearers-4c4b4.firebasestorage.app \
     --format="default(cors_config)"
   ```

4. Apply it:

   ```
   cat > cors.json <<'JSON'
   [{"origin":["https://jti-shearers.pages.dev","https://jti-shearers-viewer.pages.dev","http://localhost:5173"],
     "method":["GET"],"responseHeader":["Content-Type"],"maxAgeSeconds":3600}]
   JSON
   gcloud storage buckets update gs://shearers-4c4b4.firebasestorage.app --cors-file=cors.json
   ```

5. Re-export the report. The heading should read `Photos — N of N included`.

`cors.json` in this folder is the same content, kept in version control.

Only `GET` is allowed, and only from the app's own origins — this permits
reading photos into the report and nothing else.
