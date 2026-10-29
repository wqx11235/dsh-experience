// Boundary gate: the private library and the published starter library must not
// mix. Run locally and in CI.
//
//   node tools/check-boundaries.mjs
//
// Rules
//   1. library/ contains exactly README.md + the entries in tools/public-entries.txt
//      — nothing else may sneak in from the private library.
//   2. Every allowlisted entry is actually present (no silent drift).
//   3. The repo never contains private working data: .meta.json, .drafts/,
//      or the private-only categories (learning notes, projects, conversations).
//   4. cordis.patch.yml never pins a machine path (config.experienceRoot).
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SKIP_DIRS = new Set(['.git', 'node_modules', '.npm-cache', '.npm-logs', '.tmp', 'test/.stage'])
const PRIVATE_DIRS = new Set(['10-learning', '30-reinforcement', '40-projects', '50-conversation'])

const allow = (await readFile(join(REPO, 'tools/public-entries.txt'), 'utf8'))
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
const allowSet = new Set(allow)

const problems = []

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const rel = relative(REPO, join(dir, e.name)).split(sep).join('/')
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || SKIP_DIRS.has(rel)) continue
      if (rel.startsWith('test/.tmp')) continue
      await walk(join(dir, e.name), out)
    } else {
      out.push(rel)
    }
  }
  return out
}

const files = await walk(REPO)
const libraryFiles = files.filter(f => f.startsWith('library/'))
const libraryEntries = libraryFiles.filter(f => f.endsWith('.md') && f !== 'library/README.md').map(f => f.slice('library/'.length))

for (const f of libraryEntries) {
  if (!allowSet.has(f)) problems.push(`library/ 里有白名单外的条目: ${f}`)
}
for (const f of allow) {
  if (!libraryEntries.includes(f)) problems.push(`白名单条目缺失: library/${f}`)
}
if (!libraryFiles.includes('library/README.md')) problems.push('缺少 library/README.md')

for (const f of files) {
  const parts = f.split('/')
  if (PRIVATE_DIRS.has(parts[0])) problems.push(`仓库里出现私有库分类: ${f}`)
  if (parts.some(p => p === '.drafts' || p === '.meta.json')) problems.push(`仓库里出现私有工作数据: ${f}`)
}

const patchPath = join(REPO, 'cordis.patch.yml')
if (existsSync(patchPath)) {
  const patch = await readFile(patchPath, 'utf8')
  if (/experienceRoot/.test(patch.replace(/#.*$/gm, ''))) problems.push('cordis.patch.yml 里出现了 experienceRoot（会固定某台机器的库根）')
  if (/[A-Za-z]:[\\/]/.test(patch)) problems.push('cordis.patch.yml 里出现了绝对路径')
}

if (problems.length) {
  console.error('BOUNDARY FAIL:')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log(`boundary OK: ${libraryEntries.length} public entries, private library never enters the repo`)
