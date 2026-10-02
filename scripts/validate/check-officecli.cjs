#!/usr/bin/env node
/**
 * Pre-build resource gate (task-3 item 3 / T12).
 *
 * Why this exists: `resources/bin/` is listed in .gitignore and electron-builder only
 * WARNS (fileMatcher.js:273) when an `extraResources.from` pattern matches nothing.
 * A fresh clone therefore silently produces a release package whose "export to Word"
 * button is dead — exactly the F6 defect shipped in v0.2.5.
 *
 * This script turns that silent warning into a hard, non-zero-exit build failure.
 *
 * Usage: node scripts/validate/check-officecli.cjs
 */
'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const CANDIDATES = [
  path.join(ROOT, 'resources', 'bin', 'officecli.exe'),
  path.join(ROOT, 'resources', 'bin', 'officecli')
]

// Keep the list in sync with electron-builder.json5 `extraResources` and ipc.ts detectOfficeCli().
const found = CANDIDATES.filter((p) => {
  try {
    return fs.statSync(p).isFile() && fs.statSync(p).size > 0
  } catch {
    return false
  }
})

if (found.length === 0) {
  console.error('')
  console.error('FATAL: OfficeCLI binary not found — refusing to build a package without Word export.')
  console.error('')
  for (const p of CANDIDATES) console.error('  checked: ' + p)
  console.error('')
  console.error('`resources/bin/` is gitignored, so a fresh clone has no officecli binary.')
  console.error('Place a valid officecli executable at resources/bin/officecli.exe and re-run.')
  console.error('')
  process.exit(1)
}

for (const p of found) {
  const size = fs.statSync(p).size
  console.log(`officecli OK: ${p} (${(size / 1024 / 1024).toFixed(1)} MB)`)
}
process.exit(0)
