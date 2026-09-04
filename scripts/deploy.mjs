#!/usr/bin/env node
// One deploy path for the whole JTI fleet.
//
// Every app here has its own trap — the wrong lookalike folder, a wrangler
// invocation that quietly publishes a preview instead of production, a sibling
// functions/ directory that fails the build. They are all recorded in
// ../apps.json and applied here, so a deploy is `node scripts/deploy.mjs <app>`
// and nothing has to be remembered.
//
//   node scripts/deploy.mjs --list                 what exists and where it lives
//   node scripts/deploy.mjs --check                is every live site the build we have?
//   node scripts/deploy.mjs jti-issues             test, build, deploy, verify
//   node scripts/deploy.mjs jti-issues --dry-run   print the plan, touch nothing
//
// The step that matters most is the last one: after wrangler reports success it
// fetches the live URL and compares the asset hash against the dist just built.
// Wrangler says "Deployment complete" for a PREVIEW deploy too, so "it said it
// worked" has never been evidence that production changed.

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(ROOT, 'apps.json'), 'utf8'))
const DEFAULTS = manifest.defaults

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const ids = argv.filter((a) => !a.startsWith('--'))
const dryRun = flags.has('--dry-run')
const skipTests = flags.has('--skip-tests')
const noVerify = flags.has('--no-verify')

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
}

function findApp(id) {
  const app = manifest.apps.find((a) => a.id === id || a.dir === id)
  if (!app) {
    console.error(c.red(`Unknown app "${id}".`))
    console.error(`Known: ${manifest.apps.map((a) => a.id).join(', ')}`)
    process.exit(1)
  }
  return app
}

function run(cmd, args, cwd, { capture = false } = {}) {
  const shown = `${cmd} ${args.join(' ')}`
  console.log(c.dim(`  $ ${shown}   ${c.dim(`(in ${cwd.replace(ROOT, '.')})`)}`))
  if (dryRun) return { status: 0, stdout: '' }
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    console.error(c.red(`\n  FAILED: ${shown}`))
    process.exit(r.status ?? 1)
  }
  return r
}

// The <script src> hash out of a built index.html — the fingerprint that tells
// one build from another.
function bundleHash(html) {
  const m = html.match(/assets\/index[-.][A-Za-z0-9_-]+\.js/)
  return m ? m[0] : null
}

function localHash(app) {
  const dir = app.deployCwd ? join(ROOT, app.deployCwd) : join(ROOT, app.dir)
  const index = join(dir, app.dist === '.' ? 'index.html' : join(app.dist ?? DEFAULTS.dist, 'index.html'))
  if (!existsSync(index)) return null
  return bundleHash(readFileSync(index, 'utf8'))
}

async function liveHash(url) {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return { hash: bundleHash(await res.text()) }
  } catch (err) {
    return { error: err.message }
  }
}

function cmdList() {
  console.log(c.bold('\nDeployable apps\n'))
  for (const app of manifest.apps) {
    const where = app.manual ? c.yellow('manual — see notes') : app.dir
    console.log(`  ${c.bold(app.id.padEnd(22))} ${where.padEnd(24)} ${c.dim(app.url)}`)
    if (app.test) console.log(c.dim(`  ${''.padEnd(22)} has tests`))
  }
  console.log(c.bold('\nNot deployed (do not confuse these with the real source)\n'))
  for (const n of manifest.notDeployed) console.log(`  ${n.dir.padEnd(34)} ${c.dim(n.why)}`)
  console.log()
}

// Is what is live the build sitting in dist? A mismatch is either an
// undeployed change or a deploy that went somewhere other than production.
async function cmdCheck(only) {
  const picked = manifest.apps.filter((a) => !only.length || only.includes(a.id))
  const apps = picked.filter((a) => !a.manual && a.hashCheck !== false)
  const unhashed = picked.filter((a) => a.manual || a.hashCheck === false)
  console.log(c.bold('\nlocal dist vs live\n'))
  let drift = 0
  for (const app of apps) {
    const local = localHash(app)
    const { hash: live, error } = await liveHash(app.url)
    let verdict
    if (error) verdict = c.red(`unreachable (${error})`)
    else if (!local) verdict = c.dim('no local build')
    else if (local === live) verdict = c.green('match')
    else {
      verdict = c.yellow('DIFFERS')
      drift++
    }
    console.log(
      `  ${app.id.padEnd(22)} local=${(local ?? '—').padEnd(30)} live=${(live ?? '—').padEnd(30)} ${verdict}`,
    )
  }
  // The single-file apps have no asset hash to compare, so the most that can be
  // said about them is that they answer.
  for (const app of unhashed) {
    const { error } = await liveHash(app.url)
    console.log(
      `  ${app.id.padEnd(22)} ${c.dim('no asset hash to compare —')} ${
        error ? c.red(`unreachable (${error})`) : c.green('responds')
      }`,
    )
  }
  console.log(
    drift
      ? c.yellow(`\n  ${drift} app(s) differ: either built-but-not-deployed, or the deploy missed production.\n`)
      : c.green('\n  Every live site is the build we have.\n'),
  )
}

async function deploy(app) {
  console.log(c.bold(`\n=== ${app.id}  ${c.dim(app.url)}`))
  if (app.manual) {
    console.log(c.yellow('  This one has no source folder in the repo and is published by hand:'))
    for (const n of app.notes ?? []) console.log(c.dim(`    - ${n}`))
    return
  }
  for (const n of app.notes ?? []) console.log(c.dim(`  note: ${n}`))

  const appDir = join(ROOT, app.dir)
  if (!existsSync(appDir)) {
    console.error(c.red(`  ${appDir} does not exist`))
    process.exit(1)
  }

  if (app.test && !skipTests) run('npm', ['test', '--silent'], appDir)
  else if (app.test) console.log(c.yellow('  tests skipped (--skip-tests)'))

  const build = app.build === undefined ? DEFAULTS.build : app.build
  if (build) run('npm', ['run', 'build'], appDir)

  const dist = app.dist ?? DEFAULTS.dist
  const deployCwd = app.deployCwd ? join(ROOT, app.deployCwd) : appDir

  if (app.prepare) run('sh', ['-c', app.prepare], appDir)

  // Pages serves a hard 404 on a refreshed deep link without this, and it is
  // easy to lose when a dist is rebuilt from a folder that has no public/.
  if (dist !== '.') {
    const redirects = join(deployCwd, dist, '_redirects')
    if (!existsSync(redirects) && !dryRun) {
      writeFileSync(redirects, '/*    /index.html   200\n')
      console.log(c.yellow('  wrote a missing dist/_redirects (SPA fallback)'))
    }
  }

  // An absolute path, and always --branch=main. Wrangler otherwise reads the
  // CURRENT GIT BRANCH and files the upload as a preview: it reports success,
  // hands back a URL, and production keeps serving the old bundle.
  const target = dist === '.' ? '.' : join(deployCwd, dist)
  run(
    'npx',
    [
      'wrangler',
      'pages',
      'deploy',
      target,
      `--project-name=${app.id}`,
      `--branch=${DEFAULTS.branch}`,
      ...(DEFAULTS.commitDirty ? ['--commit-dirty=true'] : []),
    ],
    deployCwd,
  )

  if (dryRun || noVerify || app.hashCheck === false) {
    if (app.hashCheck === false) console.log(c.dim('  (no asset hashes on this app — check it by eye)'))
    return
  }

  const want = localHash(app)
  if (!want) {
    console.log(c.yellow('  built index.html has no asset hash; skipping verification'))
    return
  }
  process.stdout.write('  verifying production')
  for (let attempt = 1; attempt <= 6; attempt++) {
    await new Promise((r) => setTimeout(r, attempt === 1 ? 3000 : 7000))
    const { hash, error } = await liveHash(app.url)
    if (hash === want) {
      console.log(c.green(`\n  LIVE: ${app.url} is serving ${want}`))
      return
    }
    process.stdout.write('.')
    if (attempt === 6) {
      console.log(
        c.red(
          `\n  NOT LIVE: expected ${want}, ${error ? `fetch failed (${error})` : `production still serves ${hash}`}.`,
        ),
      )
      console.log(
        c.yellow(
          '  Check it went to production, not a preview:\n' +
            `    npx wrangler pages deployment list --project-name=${app.id}\n` +
            '  The top row should say Environment: Production.',
        ),
      )
      process.exitCode = 1
    }
  }
}

if (flags.has('--help') || (!ids.length && !flags.size)) {
  const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1)
  const header = lines.slice(0, lines.findIndex((l) => !l.startsWith('//')))
  console.log(header.join('\n').replace(/^\/\/ ?/gm, ''))
  process.exit(0)
}
if (flags.has('--list')) cmdList()
else if (flags.has('--check')) await cmdCheck(ids)
else {
  if (!ids.length) {
    console.error(c.red('Name at least one app, or pass --list / --check.'))
    process.exit(1)
  }
  for (const id of ids) await deploy(findApp(id))
}
