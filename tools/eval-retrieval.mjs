// Retrieval benchmark for the experience library.
//
//   node tools/eval-retrieval.mjs [libraryDir] [--limit=5]
//
// Builds queries from the entries themselves (title / 诊断关键词 / 症状 error lines),
// asks the real experience_search tool, and reports R@1 / R@3 / R@5 / no-match.
// Ground truth is the entry the query was derived from. This is a sanity metric,
// not a leaderboard: a title query is easier than how a user actually asks.
import { mkdir, writeFile, readFile, rm, access, cp, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SRC = resolve(process.argv[2] || join(REPO, 'library'))
const ROOT = join(REPO, 'test/.tmp-eval-lib')
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').slice(8)) || 5
const STAGE = join(REPO, 'test/.stage-eval')

async function findDshTools() {
  if (process.env.DSH_TOOLS_STUB === '1') return ''
  const candidates = [
    process.env.DSH_TOOLS_ENTRY,
    '../../node_modules/@deepseek-ai/dsh-tools/lib/index.js',
    join(process.env.USERPROFILE || '', '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  ].filter(Boolean)
  for (const c of candidates) {
    const p = resolve(c)
    try { await access(p); return p } catch { /* next */ }
  }
  return ''
}

async function stage() {
  await rm(STAGE, { recursive: true, force: true })
  await mkdir(join(STAGE, 'lib'), { recursive: true })
  await mkdir(join(STAGE, 'node_modules/@deepseek-ai/dsh-tools'), { recursive: true })
  await cp(join(REPO, 'index.js'), join(STAGE, 'index.js'))
  await cp(join(REPO, 'lib/promote.js'), join(STAGE, 'lib/promote.js'))
  const real = await findDshTools()
  await writeFile(join(STAGE, 'node_modules/@deepseek-ai/dsh-tools/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.0.0-test', type: 'module', main: 'index.js' }))
  await writeFile(join(STAGE, 'node_modules/@deepseek-ai/dsh-tools/index.js'),
    real ? `export { defineTool } from ${JSON.stringify(pathToFileURL(real).href)}\n` : 'export function defineTool(d) { return d }\n')
}

function makeCtx() {
  const tools = new Map()
  const routes = new Map()
  const noop = () => () => {}
  return {
    tools,
    routes,
    ctx: {
      effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
      interval: noop,
      timeout: noop,
      on: () => () => {},
      webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => {} } },
      tools: { register: (t) => { tools.set(t.name, t); return () => {} } },
    },
  }
}

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, out)
    else if (e.name.endsWith('.md') && e.name !== 'README.md') out.push(p)
  }
  return out
}

function section(text, heading) {
  const m = new RegExp(`^##\\s*${heading}[^\\n]*$`, 'm').exec(text)
  if (!m) return ''
  const rest = text.slice(m.index + m[0].length)
  const next = rest.search(/^##\s/m)
  return (next >= 0 ? rest.slice(0, next) : rest).trim()
}

function queriesFor(rel, text) {
  const out = []
  const title = (text.match(/^#\s+(.+)$/m) || [, ''])[1].trim()
  if (title.length >= 4) out.push({ kind: 'title', q: title.replace(/^⚠\s*/, '') })
  const kw = section(text, '诊断关键词').split('\n').map(l => l.replace(/^-\s*/, '').trim()).filter(Boolean)
  if (kw.length) out.push({ kind: 'keywords', q: kw.slice(0, 2).join(' ') })
  const symptom = section(text, '症状').split('\n').map(l => l.trim()).filter(l => /`[^`]+`/.test(l))
  if (symptom.length) {
    const code = (symptom[0].match(/`([^`]+)`/) || [])[1]
    if (code && code.length >= 4) out.push({ kind: 'error', q: code })
  }
  return out.map(x => ({ ...x, rel }))
}

await stage()
const mod = await import(pathToFileURL(join(STAGE, 'index.js')).href + `?t=${Date.now()}`)
const { ctx, tools } = makeCtx()
await rm(ROOT, { recursive: true, force: true })
await cp(SRC, ROOT, { recursive: true })
await mod.default.apply(ctx, { experienceRoot: ROOT })
const search = tools.get('experience_search')
if (!search) throw new Error('experience_search not registered')

const files = await walk(ROOT)
const queries = []
for (const f of files) {
  const rel = f.slice(ROOT.length + 1).split('\\').join('/')
  queries.push(...queriesFor(rel, await readFile(f, 'utf8')))
}

const buckets = {}
for (const item of queries) {
  const res = await search.execute({ query: item.q, limit: LIMIT })
  const hits = (res.hits || []).map(h => h.rel)
  const rank = hits.indexOf(item.rel) + 1
  const b = buckets[item.kind] || (buckets[item.kind] = { n: 0, r1: 0, r3: 0, r5: 0, none: 0 })
  b.n += 1
  if (rank === 1) b.r1 += 1
  if (rank > 0 && rank <= 3) b.r3 += 1
  if (rank > 0 && rank <= 5) b.r5 += 1
  if (!rank) b.none += 1
}

const total = { n: 0, r1: 0, r3: 0, r5: 0, none: 0 }
for (const b of Object.values(buckets)) for (const k of Object.keys(total)) total[k] += b[k]
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '—')

console.log(`root: ${SRC} (copied to ${ROOT} so the benchmark never writes into the source library)`)
console.log(`entries: ${files.length}  queries: ${queries.length}  limit: ${LIMIT}`)
console.log('')
console.log('| bucket | n | R@1 | R@3 | R@5 | no-match |')
console.log('| --- | ---: | ---: | ---: | ---: | ---: |')
for (const [kind, b] of Object.entries(buckets)) {
  console.log(`| ${kind} | ${b.n} | ${pct(b.r1, b.n)} | ${pct(b.r3, b.n)} | ${pct(b.r5, b.n)} | ${pct(b.none, b.n)} |`)
}
console.log(`| **all** | ${total.n} | ${pct(total.r1, total.n)} | ${pct(total.r3, total.n)} | ${pct(total.r5, total.n)} | ${pct(total.none, total.n)} |`)
await rm(STAGE, { recursive: true, force: true })
await rm(ROOT, { recursive: true, force: true })
