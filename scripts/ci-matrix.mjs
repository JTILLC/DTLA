#!/usr/bin/env node
// Turns apps.json into the CI build matrix, so adding an app to the fleet adds
// it to CI and there is no second list to keep in step.
//
// With --since <sha> it narrows the matrix to the apps a push actually touched.
// Sixteen full installs on every commit would burn the Actions budget to learn
// that nothing changed; shared/ (imported by nearly every app) and the manifest
// itself still fan out to everything.
//
//   node scripts/ci-matrix.mjs                  # every app
//   node scripts/ci-matrix.mjs --since <sha>    # only what changed since <sha>

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'apps.json'), 'utf8'))

// Buildable apps that live in THIS repo. The Jobs tracker is a hand-written
// single file and the Headcount guide has no folder here, so neither has
// anything to build; jti-timesheet is a separate git repository nested inside
// this one and git-ignored, so a runner checking out DTLA never sees it — it
// carries its own workflow.
const all = manifest.apps
  .filter((a) => a.dir && a.build !== null && !a.manual && !a.ownRepo)
  // extra: nested packages with their own package.json that the app's tests
  // import (CCW's media-worker). Space separated so the workflow can loop.
  .map((a) => ({ id: a.id, dir: a.dir, test: Boolean(a.test), extra: (a.extraInstall ?? []).join(' ') }))

const sinceIdx = process.argv.indexOf('--since')
let apps = all

if (sinceIdx !== -1) {
  const since = process.argv[sinceIdx + 1]
  const valid = since && !/^0+$/.test(since)
  let changed = null
  if (valid) {
    try {
      changed = execSync(`git diff --name-only ${since} HEAD`, { cwd: ROOT, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)
    } catch {
      changed = null // shallow clone, force-push, first push on a branch
    }
  }
  if (changed) {
    // shared/ is compiled into nearly every bundle, and a manifest or CI change
    // can alter how any app builds — either one means rebuild everything.
    const fanOut = changed.some(
      (f) => f.startsWith('shared/') || f === 'apps.json' || f.startsWith('scripts/') || f.startsWith('.github/'),
    )
    apps = fanOut ? all : all.filter((a) => changed.some((f) => f.startsWith(`${a.dir}/`)))
  }
}

const out = JSON.stringify(apps)
if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(process.env.GITHUB_OUTPUT, `apps=${out}\n`)
  appendFileSync(process.env.GITHUB_OUTPUT, `any=${apps.length > 0}\n`)
}
console.log(out)
