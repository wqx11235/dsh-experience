// One-off link consistency check for the experience library.
// Mirrors dsh-experience checkLinks(): only .md targets inside the library are
// checked, `..` is normalized, http/#/mailto are skipped.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.argv[2] || 'library'
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}
const docs = {}
for (const f of walk(ROOT)) docs[relative(ROOT, f).replaceAll('\\', '/')] = readFileSync(f, 'utf8')

const norm = (p) => {
  const out = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') { out.pop(); continue }
    out.push(seg)
  }
  return out.join('/')
}
const warn = []
for (const [rel, text] of Object.entries(docs)) {
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const t = m[1].trim()
    if (/^(https?:|#|mailto:)/.test(t)) continue
    const base = t.split('#')[0].split('?')[0]
    if (!base) continue
    const r = norm((dir ? dir + '/' : '') + base)
    if (docs[r] === undefined && r.endsWith('.md')) warn.push(`${rel} -> ${t}`)
  }
}
console.log(`docs=${Object.keys(docs).length} broken=${warn.length}`)
for (const w of warn.slice(0, 30)) console.log(' ', w)
process.exit(warn.length ? 1 : 0)
