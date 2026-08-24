# DTLA Monorepo — Copilot Instructions

## Project Overview

This is a monorepo containing multiple React/Vite web applications for JTI (Joshua Todd Industries), an Ishida equipment service company. All apps use Firebase for data and are deployed to Netlify unless noted otherwise.

## Project → Deployment Mapping

| Folder | Netlify Site | URL | Notes |
|--------|-------------|-----|-------|
| `CCWISSUESGitHub` | jti-ccwlog | https://jti-ccwlog.netlify.app/ | Admin weigher issue logger |
| `CCWCustomerViewer` | jtihv | https://jtihv.netlify.app/ | Read-only customer portal |
| `JTIUnified` | jtiapp | https://jtiapp.netlify.app/ | Unified dashboard |
| `JTIWebsite` | — | https://jtiaz.com | Company website, hosted on **Render.com** (auto-deploys on push to main) |
| `JobsMASTER` | jtidt | https://jtidt.netlify.app/ | Jobs tracker |
| `TS GitHub` | jti-ts3 | https://jti-ts3.netlify.app/ | Time sheet app |
| `ShearersClaude` | shearersjtidowntime | https://shearersjtidowntime.netlify.app/ | Shearers downtime tracker |
| `ServiceQuoteWA` | jtiservicequote | https://jtiservicequote.netlify.app/ | Service quote tool |
| `PartsViewer` | jti-ipm | https://jti-ipm.netlify.app/ | Admin parts manual |
| `PartsViewerCustomer` | customers-jti-intpartsman | https://customers-jti-intpartsman.netlify.app/ | Customer parts viewer |

## Tech Stack

- **Framework:** React (most apps use React 18/19) with Vite as build tool
- **Styling:** Mix of Bootstrap (CCW apps), Tailwind CSS (JTIWebsite, JTIUnified), and inline styles
- **Backend:** Firebase (Firestore for data, Firebase Auth for authentication)
- **Deployment:** Netlify (CLI deploy with `netlify deploy --prod --dir=dist --site=<site-id>`), except JTIWebsite which is on Render.com
- **Icons:** Lucide React across most apps

## Key Conventions

- **Head data migration:** CCW apps use a `migrateHeadData()` function to handle legacy single-error format → multi-issue array format. Always use this when reading head data.
- **Issue fixed statuses:** `not_fixed`, `fixed`, `active_with_issues` — color coded as red, orange, blue respectively.
- **No routing in most apps:** Most apps are single-page with state-driven views (no React Router), except JTIWebsite which uses React Router.
- **Dark mode:** Most apps support dark mode via CSS variables or theme state.

## Deployment Notes

- **Netlify deploys** are done via CLI: `netlify deploy --prod --dir=dist --site=<site-id>`
- **JTIWebsite (jtiaz.com)** deploys automatically when changes are pushed to the `main` branch on GitHub. Render.com watches the repo. It is a client-side only static site — no server-side functionality.
- Always build (`npx vite build`) before deploying to verify no errors.
- The `_backup_*` folders are snapshot backups and should not be modified or deployed.

## File Structure Notes

- Each app is self-contained in its own folder with its own `package.json`
- Shared utilities do not exist across apps — each app has its own copies of helpers (e.g., `migrateHeadData` exists in multiple places)
- The root `package.json` / `node_modules` are for legacy or shared tooling; individual apps have their own dependencies
