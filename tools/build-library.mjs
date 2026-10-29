// Build the public starter library from a private library.
//
//   node tools/build-library.mjs [sourceDir]
//
// Only the entries listed in tools/public-entries.txt are copied. Every copy
// goes through the redaction rules below, then through the privacy gate and the
// link check — a single leftover path, account name or broken cross-link fails
// the build. The committed `library/` directory is the reviewed artifact; the
// private library never leaves the author's machine.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles } from './privacy-rules.mjs'
import { loadLocalTerms, compileRedactions } from './local-terms.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(REPO, 'library')
const SOURCE = process.argv[2] || process.env.DSH_EXPERIENCE_SOURCE || ''
if (!SOURCE.trim()) {
  console.error('usage: node tools/build-library.mjs <private-library-dir>')
  console.error('   or: DSH_EXPERIENCE_SOURCE=<private-library-dir> node tools/build-library.mjs')
  process.exit(1)
}

// Generic redactions that never depend on the author's machine. Machine-specific
// paths and private words live in tools/private-terms.local.json (gitignored) and
// are applied first — see local-terms.mjs. Each rule is [label, regex, replacement].
const REDACTIONS = [
  ['other-home', /[A-Za-z]:[\\/]Users[\\/][A-Za-z0-9_.-]+/gi, '<home>'],
  ['unix-home', /\/home\/[A-Za-z0-9_.-]+/g, '/home/<user>'],
  ['email', /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g, '<email>'],
  ['frontmatter-source', /(<!--\s*date:\s*[0-9-]+;\s*)source:[^>]*?(?=\s*-->)/, '$1source: dsh-experience starter library'],
]

const LOCAL_REDACTIONS = compileRedactions((await loadLocalTerms()).redactions)

const root = await readFile(join(REPO, 'tools/public-entries.txt'), 'utf8')
const entries = root.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
const tweaks = JSON.parse(await readFile(join(REPO, 'tools/library-tweaks.json'), 'utf8')).rules || {}
const included = new Set([...entries, 'README.md'])

function normRel(p) {
  const out = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') { out.pop(); continue }
    out.push(seg)
  }
  return out.join('/')
}

// A link to an entry that is not part of the public set would show up as an
// index-consistency warning in the panel, so it is degraded to plain text: the
// reference stays readable, the dead link disappears.
function degradeExternalLinks(text, rel) {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  let dropped = 0
  const next = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label, target) => {
    if (/^(https?:|#|mailto:)/.test(target)) return whole
    const base = target.split('#')[0].split('?')[0]
    if (!base || !base.endsWith('.md')) return whole
    const resolved = normRel((dir ? dir + '/' : '') + base)
    if (included.has(resolved)) return whole
    dropped += 1
    return label
  })
  return { text: next, dropped }
}

const written = []
for (const rel of entries) {
  const full = join(SOURCE, rel)
  let text
  try { text = await readFile(full, 'utf8') } catch {
    console.error(`missing source entry: ${rel}`)
    process.exitCode = 1
    continue
  }
  const notes = []
  for (const [label, re, rep] of LOCAL_REDACTIONS) {
    const before = text
    text = text.replace(re, rep)
    if (before !== text) notes.push(label)
  }
  for (const [label, re, rep] of REDACTIONS) {
    const before = text
    text = text.replace(re, rep)
    if (before !== text) notes.push(label)
  }
  for (const rule of tweaks[rel] || []) {
    const before = text
    text = text.split(rule.find).join(rule.replace)
    if (before !== text) notes.push(`tweak:${rule.find.slice(0, 24)}`)
  }
  const links = degradeExternalLinks(text, rel)
  text = links.text
  if (links.dropped) notes.push(`dropped-links:${links.dropped}`)
  const target = join(OUT, rel)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, text)
  written.push({ rel, notes })
}

// Gate 1: privacy.
const leaks = await checkFiles(OUT)
// Gate 2: no broken relative links inside the public library (the panel would
// show an index-consistency warning for any of these).
const docs = {}
async function walk(dir) {
  const out = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...await walk(p))
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}
for (const f of await walk(OUT)) docs[relative(OUT, f).split(sep).join('/').replaceAll('\\', '/')] = await readFile(f, 'utf8')
const norm = (p) => {
  const out = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') { out.pop(); continue }
    out.push(seg)
  }
  return out.join('/')
}
const broken = []
for (const [rel, text] of Object.entries(docs)) {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const t = m[1].trim()
    if (/^(https?:|#|mailto:)/.test(t)) continue
    const base = t.split('#')[0].split('?')[0]
    if (!base || !base.endsWith('.md')) continue
    const r = norm((dir ? dir + '/' : '') + base)
    if (docs[r] === undefined) broken.push(`${rel} -> ${t}`)
  }
}

console.log(`source: ${SOURCE}`)
console.log(`wrote ${written.length} entries into library/`)
for (const w of written) if (w.notes.length) console.log(`  ${w.rel}  [${w.notes.join(', ')}]`)
console.log(`privacy leaks: ${leaks.length}`)
for (const l of leaks.slice(0, 30)) console.log(`  ${l.file}:${l.line}  ${l.rule}  ${l.excerpt}`)
console.log(`broken links: ${broken.length}`)
for (const b of broken) console.log(`  ${b}`)

if (leaks.length || broken.length) {
  console.error('\nBUILD FAILED: fix the entries (tools/library-tweaks.json) and rebuild.')
  process.exitCode = 1
} else {
  console.log('\nBUILD OK')
}
