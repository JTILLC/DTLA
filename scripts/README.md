# Fleet scripts

Seventeen live apps, one manifest.

`../apps.json` is the source of truth: for every deployed app it records the
folder it is **really** built from, the Cloudflare Pages project it goes to, and
the traps that folder carries. Both the deploy script and CI read it, so a
correction here fixes both.

## Deploying

```sh
node scripts/deploy.mjs --list          # every app, its folder, its URL
node scripts/deploy.mjs --check         # is each live site the build we have?
node scripts/deploy.mjs jti-issues      # test → build → deploy → verify production
node scripts/deploy.mjs jti-issues --dry-run
```

Flags: `--dry-run`, `--skip-tests`, `--no-verify`. Several apps can be named at
once.

What the script does that a hand-typed wrangler call does not:

- **Always passes `--branch=main`.** Without it wrangler reads the *current git
  branch* and files the upload as a preview — it reports "Deployment complete",
  hands back a URL, and production keeps serving the old bundle. On a branch
  like `refactor/jti-dashboard` that is the default outcome.
- **Verifies production afterwards.** It compares the asset hash in the live
  page against the `dist` it just built, retrying while Cloudflare propagates.
  "Wrangler said it worked" has never been evidence that anything changed.
- **Uses absolute paths and the right working directory,** so a relative `dist`
  cannot resolve to a different app's build, and so the Jobs deploy runs from
  inside `cf-jobs/` where wrangler cannot see the Firebase `functions/` folder
  it would otherwise choke on.
- **Writes a missing `dist/_redirects`,** without which a refreshed deep link
  404s on Pages.
- **Prints each app's notes first** — the service worker on the dashboard, the
  stale forks in the Headcount folder, which parts app is the customer one.

If wrangler reports `Failed to fetch auth token`, run `npx wrangler login` once
in a terminal; the token refresh needs a real TTY.

## CI

`.github/workflows/ci.yml` builds and tests each app on every push. The matrix
comes from `apps.json` via `ci-matrix.mjs`, so adding an app to the fleet adds
it to CI.

A push that touches one app builds one app. A change under `shared/`,
`scripts/`, `.github/` or `apps.json` rebuilds everything, because `shared/`
ends up inside nearly every bundle.

`check-react-import.mjs` runs first, on the whole repo. Vite's automatic JSX
runtime lets a file use `React.memo` without importing React: it builds clean
and throws "React is not defined" on the first render. That shipped a blank app
during the Cloudflare move and no build step can catch it.

The **Timesheet** is a separate GitHub repository nested inside this one and
git-ignored here, so this CI cannot see it. It has its own copy of the same
workflow at `jti-timesheet/.github/workflows/ci.yml`, committed from inside that
folder.
