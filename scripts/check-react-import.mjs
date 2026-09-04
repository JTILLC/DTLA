#!/usr/bin/env node
// Catches the one bug that has actually shipped a blank app to production.
//
// Vite's automatic JSX runtime means JSX compiles without React in scope, so a
// file can use `React.memo` / `React.useState`, build with no warning, and then
// throw "React is not defined" on the first render — a white screen for anyone
// who loads it. It happened to JTI Inventory during the Cloudflare move, and
// only an older good build on the old host hid it.
//
// A build cannot catch this. A grep can.
//
//   node scripts/check-react-import.mjs            # whole repo
//   node scripts/check-react-import.mjs JTIUnified # one folder

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', 'dist', '_archive', '.git', 'build', 'coverage'])
const roots = process.argv.slice(2).map((p) => join(ROOT, p))

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP.has(entry) || entry.startsWith('.')) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) yield* walk(full)
    else if (/\.(jsx?|tsx?)$/.test(entry)) yield full
  }
}

// Strip comments and strings so a `React.memo` inside a note or a doc string is
// not reported as a real reference.
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
}

const bad = []
for (const dir of roots.length ? roots : [ROOT]) {
  for (const file of walk(dir)) {
    const src = readFileSync(file, 'utf8')
    const body = code(src)
    const uses = body.match(/\bReact\s*\./g)
    if (!uses) continue
    const imported =
      /import\s+React\b/.test(body) ||
      /import\s+\*\s+as\s+React\b/.test(body) ||
      /\brequire\(\s*['"]react['"]\s*\)/.test(body) ||
      /\bconst\s+React\b/.test(body)
    if (!imported) {
      const line = src.split('\n').findIndex((l) => /\bReact\s*\./.test(l)) + 1
      bad.push({ file: relative(ROOT, file), line, sample: uses[0].replace(/\s+/g, '') })
    }
  }
}

if (bad.length) {
  console.error('\nReact used without importing it — these build clean and crash on render:\n')
  for (const b of bad) console.error(`  ${b.file}:${b.line}  uses ${b.sample}`)
  console.error('\nFix: add `import React from "react"` at the top of each file.\n')
  process.exit(1)
}
console.log(`No unimported React usage${roots.length ? ` in ${process.argv.slice(2).join(', ')}` : ''}.`)
