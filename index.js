// dsh-experience — host half (v2: self-learning & correction).
// Indexes the DSH experience library and serves it via HTTP endpoints and
// agent tools. Implements the ROADMAP mechanisms: auto-refresh index (P0-1),
// tokenized + CJK-bigram search (P0-2), usage stats & hot-sort (L4), error
// signature routing (A1), one-click feedback / confidence decay (C4/C5),
// inbox error capture + draft pipeline (L1/L5), dedup (L3), link consistency
// (P1-4), verify checks (C1), version anchoring (C2), similarity/conflict
// marks (C3), fuzzy semantic fallback (A2), aggregated answers (A3),
// no-match suggestions (A5), and search metrics (A6).
import { readFile, writeFile, readdir, stat, access, mkdir, unlink, rename, cp } from 'node:fs/promises'
import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Pure "gap → entry" rules (classification / template / dedup / README row).
// Kept in a module so they can be unit-tested without a host.
import {
  classifyFailure, buildEntryMarkdown, missingSections, slugify,
  findSimilar, buildReadmeRow, insertReadmeRow, draftSignature, draftSymptom,
} from './lib/promote.js'

// Library root precedence: bundle config (`experienceRoot`) > DSH_EXPERIENCE_ROOT
// > ~/.dsh/experience. It is a user-writable copy, never the package directory, so
// edits survive plugin upgrades and several profiles can share one library.
const DEFAULT_ROOT = (process.env.DSH_EXPERIENCE_ROOT || '').trim()
  ? resolve(process.env.DSH_EXPERIENCE_ROOT.trim())
  : join(homedir(), '.dsh', 'experience')
// Starter library shipped inside the package (read-only). It is copied into the
// root on first run only; an existing library is never overwritten.
const PACKAGE_LIBRARY = join(dirname(fileURLToPath(import.meta.url)), 'library')
let ROOT = DEFAULT_ROOT
let META_FILE = join(ROOT, '.meta.json')
let DRAFTS_DIR = join(ROOT, '.drafts')
const POLL_MS = 3000
const VERIFY_MS = 4 * 60 * 60 * 1000

function setRoot(next) {
  if (typeof next !== 'string' || next.trim() === '') return
  ROOT = resolve(next)
  META_FILE = join(ROOT, '.meta.json')
  DRAFTS_DIR = join(ROOT, '.drafts')
}

// First run: copy the packaged starter library. Skipped when the root already
// holds documents (so a user's library is never replaced) and when the bundle
// sets `seed: false`.
async function seedLibrary(config) {
  if (config && config.seed === false) return
  let entries = null
  try { entries = await readdir(ROOT) } catch { entries = null }
  if (entries && entries.some(n => n.endsWith('.md'))) return
  try { await access(PACKAGE_LIBRARY) } catch { return }
  await mkdir(ROOT, { recursive: true })
  await cp(PACKAGE_LIBRARY, ROOT, { recursive: true, force: false, errorOnExist: false })
  console.log(`[experience] seeded starter library into ${ROOT}`)
}

// The host package lives in a different place per runtime (an npm runtime dir, a
// pnpm store, inside an Electron ASAR). Walk up from the running entry the way
// dshmarket's dsh-install does, instead of hardcoding one machine's path.
function findDshManifest(entry = process.argv[1]) {
  if (!entry) return null
  let dir
  try { dir = dirname(realpathSync(entry)) } catch { dir = dirname(resolve(entry)) }
  for (let i = 0; i < 10; i += 1) {
    try {
      const text = readFileSync(join(dir, 'package.json'), 'utf8').replace(/^\uFEFF/, '')
      if (JSON.parse(text).name === '@deepseek-ai/dsh') return join(dir, 'package.json')
    } catch { /* not a manifest here */ }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    // B3: hidden entries (.drafts, .meta.json) are working data, never library docs.
    if (entry.name.startsWith('.')) continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(p))
    else if (entry.name.endsWith('.md')) out.push(p)
  }
  return out
}

async function firstParagraph(text) {
  const lines = text.split('\n')
  const para = []
  let started = false
  let inCode = false
  for (const line of lines) {
    const raw = line.trim()
    if (raw.startsWith('```')) { inCode = !inCode; if (started && !inCode) break; continue }
    if (inCode) continue
    if (raw === '') { if (started && para.length) break; continue }
    if (raw.startsWith('#') || raw.startsWith('---') || raw.startsWith('|')) { if (started) break; continue }
    if (raw.startsWith('>')) {
      const t = raw.replace(/^>\s*/, '')
      if (t) { started = true; para.push(t) }
      continue
    }
    started = true
    para.push(raw)
    if (para.join(' ').length > 160) break
  }
  return para.join(' ').slice(0, 240)
}

// A1 (accuracy): body of one `## <heading>` section, lowercased. Experience files
// share a fixed shape (症状/原因/避坑/诊断关键词); matches in the high-signal
// sections discriminate far better than prose, so retrieval weights them up.
function zoneText(text, heading) {
  const re = new RegExp(`^##\\s*${heading}[^\\n]*$`, 'm')
  const m = re.exec(text)
  if (!m) return ''
  const rest = text.slice(m.index + m[0].length)
  const next = rest.search(/^##\s/m)
  return (next >= 0 ? rest.slice(0, next) : rest).toLowerCase()
}

// ③ Heading owning one character offset, for labeling a snippet with its section.
function sectionAt(text, idx) {
  if (idx < 0) return ''
  const heads = [...text.slice(0, idx).matchAll(/^##\s*(.+)$/gm)]
  return heads.length ? heads[heads.length - 1][1].trim().slice(0, 24) : ''
}

// ③ A line-aligned snippet: never starts mid-frontmatter or mid-line, and names
// the section the match lives in. Falls forward to the next meaningful line when
// the hit lands in front-matter or a heading.
function makeSnippet(text, idx, title) {
  if (idx < 0) return title
  const lineStart = text.lastIndexOf('\n', idx) + 1
  let lineEnd = text.indexOf('\n', idx)
  if (lineEnd < 0) lineEnd = text.length
  let line = text.slice(lineStart, lineEnd).trim()
  if (!line || line.startsWith('<!--') || line.startsWith('#') || line.startsWith('---')) {
    line = ''
    for (const raw of text.slice(lineEnd + 1).split('\n')) {
      const t = raw.trim()
      if (!t || t.startsWith('<!--') || t.startsWith('#') || t.startsWith('---')) continue
      line = t
      break
    }
    if (!line) line = title
  }
  const sec = sectionAt(text, idx)
  const body = line.replace(/\s+/g, ' ').slice(0, 180)
  return (sec ? `[${sec}] ` : '') + body
}

// Front-matter comment: <!-- date: ..; source: ..; dshVersion: ..; verify: path <p>; verify: url <u> -->
function parseMeta(text) {
  const meta = {}
  const m = text.match(/^\s*<!--\s*([\s\S]*?)\s*-->/)
  if (m) {
    for (const raw of m[1].split(';')) {
      const i = raw.indexOf(':')
      if (i <= 0) continue
      const key = raw.slice(0, i).trim()
      const val = raw.slice(i + 1).trim()
      if (key === 'verify') {
        if (!meta.verify) meta.verify = []
        const vi = val.indexOf(' ')
        meta.verify.push(vi > 0 ? { kind: val.slice(0, vi), target: val.slice(vi + 1) } : { kind: val, target: '' })
      } else {
        meta[key] = val
      }
    }
  }
  return meta
}

// Normalize a repo-relative path so `..`/`.` segments resolve before comparing
// against the doc keys. Without this, every correct cross-directory link
// (`../06-shell-tooling/x.md`) was reported as a broken link.
function normalizeRel(p) {
  const out = []
  for (const seg of String(p).split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') { out.pop(); continue }
    out.push(seg)
  }
  return out.join('/')
}

function checkLinks(docs) {
  const warnings = []
  const re = /\]\(([^)]+)\)/g
  for (const rel of Object.keys(docs)) {
    const text = docs[rel].text
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
    let m
    while ((m = re.exec(text))) {
      const target = m[1].trim()
      if (/^(https?:|#|mailto:)/.test(target)) continue
      const base = target.split('#')[0].split('?')[0]
      if (!base) continue
      const resolved = normalizeRel((dir ? dir + '/' : '') + base)
      if (docs[resolved] !== undefined) continue
      if (resolved.endsWith('.md')) warnings.push(`${rel} 引用了不存在的文件: ${target}`)
    }
  }
  return warnings
}

// Top-level library layout surfaced by the panel (mirrors experience/README.md
// 「五个库」). A library groups one or more topical directories; the bug library
// deliberately groups 01-07 so their relative links and per-directory READMEs
// stay intact.
const LIBRARIES = [
  { id: 'global', name: '全局库', desc: '每次都要执行的通用动作与检查表', dirs: ['00-global'] },
  { id: 'bugs', name: 'bug 库', desc: '踩过的坑与故障（按技术主题细分）', dirs: ['01-plugin-development', '02-configuration', '03-filesystem-and-sandbox', '04-diagnosis-methodology', '05-runtime-and-process', '06-shell-tooling', '07-web-frontend'] },
  { id: 'optimizations', name: '优化库', desc: '让某处变得更好：性能 / 体验 / 流程', dirs: ['20-optimizations'] },
  { id: 'reinforcement', name: '强化学习库', desc: '被用户强调 / 夸奖的成功过程', dirs: ['30-reinforcement'] },
  { id: 'projects', name: '项目总结库', desc: '项目总结与插件制作任务书', dirs: ['40-projects'] },
  { id: 'templates', name: '模板库', desc: '可复制的插件骨架与经验模板', dirs: ['99-templates'] },
]

function isCJK(ch) {
  const c = ch.charCodeAt(0)
  return (c >= 0x3400 && c <= 0x4DBF) || (c >= 0x4E00 && c <= 0x9FFF)
    || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0x3040 && c <= 0x30FF) || (c >= 0xAC00 && c <= 0xD7AF)
}

function bigramsOf(s) {
  const out = []
  for (let i = 0; i < s.length - 1; i++) {
    if (isCJK(s[i]) && isCJK(s[i + 1])) out.push(s.slice(i, i + 2))
  }
  return out
}

// A1: error-signature patterns; a matched signature in the query gets heavy weight.
// `id` is the stable key used to track how often an error signature recurs
// (repeated-mistake weighting, see repeatBoost).
// Every pattern MUST carry the `i` flag: search() passes an already-lowercased
// query, so a case-sensitive pattern like /\bEPERM\b/ never matches and that
// signature's weighting silently does nothing.
const SIGNATURES = [
  { id: 'module-not-found', re: /ERR_MODULE_NOT_FOUND|Cannot find package/i, weight: 3 },
  { id: 'cannot-find-module', re: /Cannot find module/i, weight: 2 },
  { id: 'module-not-found-2', re: /MODULE_NOT_FOUND/i, weight: 2 },
  { id: 'eperm-eacces', re: /\bEPERM\b|\bEACCES\b/i, weight: 3 },
  { id: 'access-denied', re: /Access denied/i, weight: 2 },
  { id: 'service-not-declared', re: /service "[^"]+" is not declared/i, weight: 3 },
  { id: 'js-error', re: /ReferenceError|TypeError|SyntaxError/i, weight: 2 },
  { id: 'not-lossless-json', re: /not lossless JSON|INVALID_TOOL_OUTPUT|returned invalid output/i, weight: 3 },
  { id: 'conn-reset', re: /ECONNRESET|fetch failed/i, weight: 2 },
  { id: 'sandbox-denied', re: /sandbox: file access denied/i, weight: 3 },
  { id: 'error-nnn', re: /Error \d+/i, weight: 2 },
  { id: 'not-a-function', re: /is not a function|is not defined/i, weight: 2 },
]

// Canonical sample text per signature. A promoted entry that carries no sample
// would not satisfy libraryCoversSignature() (it tests the pattern, not the id),
// so the gap would stay open after a promotion — this closes that hole.
const SIGNATURE_SAMPLE = {
  'module-not-found': 'ERR_MODULE_NOT_FOUND',
  'cannot-find-module': 'Cannot find module',
  'module-not-found-2': 'MODULE_NOT_FOUND',
  'eperm-eacces': 'EPERM',
  'access-denied': 'Access denied',
  'service-not-declared': 'service "x" is not declared',
  'js-error': 'TypeError',
  'not-lossless-json': 'value is not lossless JSON',
  'conn-reset': 'fetch failed',
  'sandbox-denied': 'sandbox: file access denied',
  'error-nnn': 'Error 1730',
  'not-a-function': 'is not a function',
}

function signatureWeight(q) {
  let weight = 0
  let id = ''
  for (const s of SIGNATURES) if (s.re.test(q)) { weight = Math.max(weight, s.weight); id = s.id }
  return { weight, id }
}

// Repeated-mistake heat: an error signature searched again and again (and soon
// after the last time) boosts the hits that resolve it, so retrieval adapts
// faster to a recurring scenario. Time-decayed so a signature that stops being
// searched fades; capped so no single signature dominates forever.
const SIG_BOOST_CAP = 12
function repeatBoost(count, lastTs) {
  if (!count) return 0
  const hours = (Date.now() - lastTs) / 3.6e6
  const recency = 1 / (1 + Math.max(0, hours))
  return Math.min(SIG_BOOST_CAP, Math.round(count * (0.5 + recency)))
}

// ① Severity boost: entries tagged `severity: critical` (e.g. "this breaks the
// whole harness") rank above equivalent hits. Kept modest and applied only to
// already-matching items, so it reorders relevance instead of pulling in noise.
const SEVERITY_BOOST = { critical: 25, high: 12 }

// A3: synonym expansion so a wording difference between query and entry does not
// miss. Alias matches score at half weight; primary tokens keep full weight.
const ALIASES = {
  '沙箱': ['sandbox'],
  'sandbox': ['沙箱'],
  '重启': ['restart', 'reload', '重载'],
  '重载': ['reload', 'restart', '重启'],
  '插件': ['plugin'],
  'plugin': ['插件'],
  '报错': ['error', '错误', '失败'],
  '错误': ['error', '报错'],
  '权限': ['permission', 'access denied'],
  '代理': ['proxy'],
  '编码': ['encoding', 'gbk', 'utf8', 'utf-8'],
  '路径': ['path', '目录'],
  '目录': ['path', '路径'],
}

export default {
  name: 'dsh-experience',
  inject: ['timer', 'webServer', 'tools'],
  async apply(ctx, config) {
    // A bundle patch passes its `config:` block as the second argument — that is
    // how the library root travels with the deployment instead of being hardcoded.
    setRoot(config?.experienceRoot || process.env.DSH_EXPERIENCE_ROOT)
    await seedLibrary(config)
    // 0.1.x 的服务代理允许 ctx.get()；0.2.x 收紧后必须直接取属性（且必须在 inject 里声明）。
    // 两代都试：否则在 0.2.1 上 webServer 为 undefined → 一条路由都不注册 → /experience/* 全 404。
    const webServer = ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : undefined)
    const tools = ctx.tools || (typeof ctx.get === 'function' ? ctx.get('tools') : undefined)

    // ── meta persistence (.meta.json: stats / confidence / verify / inbox / search metrics) ──
    let meta = { stats: {}, confidence: {}, verify: {}, search: { total: 0, noMatch: 0 }, inbox: [] }
    let saving = Promise.resolve()
    async function loadMeta() {
      try {
        meta = JSON.parse(await readFile(META_FILE, 'utf8'))
      } catch { /* fresh */ }
      meta.stats ||= {}
      meta.confidence ||= {}
      meta.verify ||= {}
      meta.search ||= { total: 0, noMatch: 0 }
      meta.inbox ||= []
      meta.inboxArchive ||= []
      meta.promoted ||= {}
      meta.signatureFreq ||= {}
      meta.drafted ||= {}
      meta.resolveMap ||= {}
      meta.missed ||= []
      meta.fixes ||= []
      meta.suggest ||= {}
    }
    function saveMeta() {
      saving = saving.then(async () => {
        try { await writeFile(META_FILE, JSON.stringify(meta, null, 2)) } catch (e) { console.error('[experience] meta save failed', e.message) }
      })
      return saving
    }
    await loadMeta()

    let dshVersion = ''
    async function readDshVersion() {
      const manifest = findDshManifest()
      if (manifest === null) return
      try {
        dshVersion = JSON.parse((await readFile(manifest, 'utf8')).replace(/^\uFEFF/, '')).version || ''
      } catch { /* ignore */ }
    }
    await readDshVersion()

    // ── index (self-refreshing) ──
    let index = []
    let catalog = { categories: [], guide: [], warnings: [], similar: [] }
    // A2: rel -> Set(near-duplicate rels), rebuilt together with the index.
    let similarMap = {}
    let stamp = ''

    function confidenceOf(rel) {
      return typeof meta.confidence[rel] === 'number' ? meta.confidence[rel] : 1
    }

    async function rebuild() {
      try {
        const files = await walk(ROOT)
        const docs = {}
        const items = []
        for (const f of files) {
          const text = await readFile(f, 'utf8')
          const m = text.match(/^#\s+(.+)$/m)
          const rel = relative(ROOT, f).replaceAll('\\', '/')
          const title = m ? m[1].trim() : basename(f)
          docs[rel] = { title, text }
          items.push({ rel, title, text, meta: parseMeta(text), zones: { kw: zoneText(text, '诊断关键词'), fix: zoneText(text, '避坑') } })
        }
        index = items

        const guide = []
        const rootDoc = docs['README.md']
        if (rootDoc) {
          const re = /^\d+\.\s*\*\*(.+?)\*\*\s*→\s*`([^`]+)`/gm
          let m
          while ((m = re.exec(rootDoc.text))) guide.push({ scene: m[1].trim(), target: m[2].trim() })
        }

        const byDir = {}
        for (const rel of Object.keys(docs)) {
          if (rel === 'README.md') continue
          const dir = rel.includes('/') ? rel.split('/')[0] : '(root)'
          if (!byDir[dir]) byDir[dir] = []
          byDir[dir].push(rel)
        }
        const metaByRel = {}
        for (const it of items) metaByRel[it.rel] = it.meta
        const categories = []
        for (const dir of Object.keys(byDir).sort()) {
          const filesArr = []
          let summary = ''
          for (const rel of byDir[dir]) {
            const role = basename(rel) === 'README.md' ? 'index' : 'doc'
            if (role === 'index') summary = await firstParagraph(docs[rel].text)
            const st = meta.stats[rel] || {}
            filesArr.push({ rel, title: docs[rel].title, role, readCount: st.readCount || 0, hitCount: st.hitCount || 0, severity: (metaByRel[rel] && metaByRel[rel].severity) || '' })
          }
          // L4: hot files first within a category (README stays on top).
          filesArr.sort((a, b) => (a.role === b.role ? (b.readCount - a.readCount) || a.rel.localeCompare(b.rel) : a.role === 'index' ? -1 : 1))
          categories.push({ dir, summary, count: filesArr.length, files: filesArr })
        }

        const libraries = LIBRARIES.map(def => {
          const dirs = def.dirs
            .map(d => categories.find(c => c.dir === d))
            .filter(Boolean)
            .map(c => ({ dir: c.dir, count: c.count, summary: c.summary }))
          return { id: def.id, name: def.name, desc: def.desc, dirs, count: dirs.reduce((a, d) => a + d.count, 0) }
        }).filter(l => l.dirs.length > 0)

        const warnings = checkLinks(docs)

        // C3: pairwise similarity (title + head text bigram Jaccard) — overlap marks.
        const similar = []
        const gramSet = (s) => { const g = bigramsOf(s); return { set: new Set(g), n: g.length } }
        const cached = {}
        const allRels = Object.keys(docs).filter(r => r !== 'README.md')
        for (let i = 0; i < allRels.length; i++) {
          for (let j = i + 1; j < allRels.length; j++) {
            const a = allRels[i]
            const b = allRels[j]
            if (!cached[a]) cached[a] = gramSet((docs[a].title + ' ' + docs[a].text.slice(0, 300)).toLowerCase())
            if (!cached[b]) cached[b] = gramSet((docs[b].title + ' ' + docs[b].text.slice(0, 300)).toLowerCase())
            const sa = cached[a]
            const sb = cached[b]
            const union = new Set([...sa.set, ...sb.set])
            let inter = 0
            for (const g of sa.set) if (sb.set.has(g)) inter++
            const jaccard = union.size ? inter / union.size : 0
            if (jaccard >= 0.45 && sa.n > 0 && sb.n > 0) similar.push({ a, b, score: Math.round(jaccard * 100) })
          }
        }
        similar.sort((x, y) => y.score - x.score)
        const map = {}
        for (const { a, b } of similar) {
          if (!map[a]) map[a] = new Set()
          map[a].add(b)
          if (!map[b]) map[b] = new Set()
          map[b].add(a)
        }
        similarMap = map

        catalog = { libraries, categories, guide, warnings, similar }
        return { ok: true, count: items.length, warnings }
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err) }
      }
    }

    async function computeStamp() {
      try {
        const files = await walk(ROOT)
        let s = ''
        for (const f of files) {
          const st = await stat(f)
          s += relative(ROOT, f).replaceAll('\\', '/') + ':' + st.mtimeMs + ';'
        }
        return s
      } catch { return '' }
    }

    await rebuild()
    stamp = await computeStamp()

    ctx.effect(() => ctx.interval(async () => {
      const cur = await computeStamp()
      if (cur && cur !== stamp) {
        stamp = cur
        await rebuild()
      }
    }, POLL_MS))

    // ── C1: verify checks (`<!-- verify: path <p> -->` / `<!-- verify: url <u> -->`) ──
    async function verifyAll() {
      for (const item of index) {
        if (!item.meta.verify || !item.meta.verify.length) continue
        const results = {}
        for (const v of item.meta.verify) {
          try {
            if (v.kind === 'path' && v.target) {
              await access(resolve(ROOT, v.target))
              results[`path:${v.target}`] = true
            } else if (v.kind === 'url' && v.target) {
              const r = await fetch(v.target, { method: 'HEAD', signal: AbortSignal.timeout(5000) })
              results[`url:${v.target}`] = r.ok
            } else {
              results[`${v.kind}:${v.target}`] = false
            }
          } catch {
            results[`${v.kind}:${v.target}`] = false
          }
        }
        meta.verify[item.rel] = { checkedAt: Date.now(), results }
      }
      saveMeta()
    }
    const v0 = ctx.timeout(verifyAll, 2000)
    ctx.effect(() => v0)
    ctx.effect(() => ctx.interval(verifyAll, VERIFY_MS))

    // ── L1: error capture into inbox ──
    // B2: each record carries the scenario (tool / last query / turn / repeat
    // count) so a collected problem is actionable without re-deriving context.
    function addInbox(kind, message, extra) {
      const msg = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 400)
      if (!msg) return
      // 候选只采集、不抑制：素材必须在"被整理"之前一直可见（否则等于把证据扔掉）。
      // 库里已有条目覆盖的，仅打 covered 标记，归档与否由人决定。
      let coveredByLibrary = false
      try { coveredByLibrary = inboxCovered({ message: msg }) } catch (err) { coveredByLibrary = false }
      const info = extra && typeof extra === 'object' ? extra : {}
      // Not every tool failure is a missing experience: operation-discipline
      // and configuration failures are answered elsewhere and must not become
      // drafts or gaps. `knowledge` (the default) is the only promotable class.
      const fail = classifyFailure(msg)
      const existing = meta.inbox.find(i => i.kind === kind && i.message === msg)
      if (existing) {
        existing.repeat = (existing.repeat || 1) + 1
        existing.lastTs = Date.now()
        if (info.tool && !existing.tool) existing.tool = info.tool
        if (existing.cls === undefined && fail.cls !== 'knowledge') { existing.cls = fail.cls; existing.clsReason = fail.reason }
        saveMeta()
        return existing
      }
      const item = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), kind, message: msg, repeat: 1 }
      if (fail.cls !== 'knowledge') { item.cls = fail.cls; item.clsReason = fail.reason }
      if (coveredByLibrary) item.covered = true
      if (info.tool) item.tool = String(info.tool)
      if (info.query) item.query = String(info.query).slice(0, 200)
      if (info.turn !== undefined) item.turn = info.turn
      if (info.step !== undefined) item.step = info.step
      meta.inbox.push(item)
      if (meta.inbox.length > 50) meta.inbox = meta.inbox.slice(-50)
      saveMeta()
      return item
    }
    ctx.on('agent/error', (payload) => {
      const err = payload && payload.error
      const msg = err && (err.message || String(err))
      if (msg) addInbox('agent-error', String(msg), {
        turn: payload && payload.turn, step: payload && payload.step, query: lastQuery,
      })
    })
    // ④ pending failures per tool, so the next success can be recorded as the fix.
    const pendingFail = new Map()
    const FIX_WINDOW_MS = 30 * 60 * 1000
    const safeJson = (v) => { try { return JSON.stringify(v) } catch { return String(v) } }
    ctx.on('tools/result', (exec, result) => {
      if (!result || typeof result !== 'object') return
      const name = (exec && exec.name) || '?'
      // B1: the canonical result is { isError, content, error? , value? } — NOT
      // { ok }. Failures arrive as isError:true (thrown/registry errors, e.g.
      // ToolOutputError "value is not lossless JSON"), or as a value.ok===false
      // a tool returned itself. Capture both.
      if (result.isError === true) {
        const detail = (result.error && result.error.message)
          || (Array.isArray(result.content)
            ? result.content.filter(b => b && b.type === 'text').map(b => b.text).join(' ')
            : '')
          || 'tool failed'
        const item = addInbox('tool-error', `tool ${name} failed: ${String(detail)}`, { tool: name, query: lastQuery })
        if (item) pendingFail.set(name, { id: item.id, ts: Date.now(), error: String(detail) })
        // ⑤ honest negative: if this exact mistake recurs after an entry was read
        // for it, that entry did not resolve it — record the miss.
        const sig = signatureWeight(String(detail).toLowerCase())
        const pr = meta.pendingRead
        if (sig.id && pr && pr.sigId === sig.id && Date.now() - pr.ts <= RESOLVE_WINDOW_MS) {
          const m = meta.resolveMap[sig.id] || (meta.resolveMap[sig.id] = {})
          const rec = m[pr.rel] || (m[pr.rel] = { count: 0, lastTs: 0 })
          rec.miss = (rec.miss || 0) + 1
          m[pr.rel] = rec
          meta.pendingRead = null
          // ② the push did not help: raise this signature's bar so it is
          // suggested less (fewer, better interruptions).
          if (meta.suggest[sig.id]) meta.suggest[sig.id].failed = (meta.suggest[sig.id].failed || 0) + 1
          saveMeta()
        }
        return
      }
      const value = result.value
      if (value && typeof value === 'object' && value.ok === false) {
        const item = addInbox('tool-value-error', `tool ${name} reported ok:false: ${String(value.error || JSON.stringify(value))}`, { tool: name, query: lastQuery })
        if (item) pendingFail.set(name, { id: item.id, ts: Date.now(), error: String(value.error || '') })
        return
      }
      // ④ the same tool succeeding after a failure is the fix evidence: keep the
      // successful arguments, which is the half the inbox never captured.
      const pend = pendingFail.get(name)
      if (pend && Date.now() - pend.ts <= FIX_WINDOW_MS) {
        pendingFail.delete(name)
        const fix = safeJson(exec && exec.arguments).slice(0, 400)
        meta.fixes ||= []
        meta.fixes.push({ tool: name, error: pend.error.slice(0, 200), fix, ts: Date.now() })
        if (meta.fixes.length > 50) meta.fixes = meta.fixes.slice(-50)
        const item = meta.inbox.find(i => i.id === pend.id)
        if (item) { item.fix = fix; item.fixTs = Date.now() }
        saveMeta()
      }
    })

    // ── search (tokenized + CJK bigram + signatures + fuzzy fallback) ──
    // B2: last query, attached to captured errors so a problem record carries
    // the scenario it happened in.
    let lastQuery = ''
    function enrichHit(hit) {
      const st = meta.stats[hit.rel] || {}
      const conf = confidenceOf(hit.rel)
      const v = meta.verify[hit.rel]
      const im = hit.itemMeta || {}
      const out = {
        rel: hit.rel,
        title: hit.title,
        snippet: hit.snippet,
        readCount: st.readCount || 0,
        confidence: conf,
      }
      // Emit optional fields only when they actually have a value. DSH treats a
      // present property whose value is `undefined` as non-lossless JSON, so an
      // always-set `stale`/`date`/`dshVersion`/`verified` property breaks every
      // tool result with hits ("value is not lossless JSON").
      if (im.dshVersion && dshVersion) out.stale = dshVersion !== im.dshVersion
      if (im.date) out.date = im.date
      if (im.dshVersion) out.dshVersion = im.dshVersion
      if (im.severity) out.severity = String(im.severity).slice(0, 16)
      if (v !== undefined) out.verified = Object.values(v.results).every(Boolean)
      return out
    }

    // B4: a read that follows a signature search is treated as "this entry is the
    // resolver for that mistake" (read-as-click), closing the collect -> weight
    // loop: recurring signature -> boosted resolver entries next time.
    let lastSearch = null
    const RESOLVE_WINDOW_MS = 10 * 60 * 1000
    function noteRead(rel) {
      if (!lastSearch || !lastSearch.sigId) return
      if (Date.now() - lastSearch.ts > RESOLVE_WINDOW_MS) return
      if (!lastSearch.rels.has(rel)) return
      const sigId = lastSearch.sigId
      meta.resolveMap ||= {}
      const m = meta.resolveMap[sigId] || (meta.resolveMap[sigId] = {})
      const rec = m[rel] || { count: 0, lastTs: 0 }
      rec.count++
      rec.lastTs = Date.now()
      m[rel] = rec
      lastSearch = null
      // ⑤ a read is a claim we can test: if the same mistake recurs inside the
      // window, the miss counter records that this entry did not resolve it.
      meta.pendingRead = { sigId, rel, ts: Date.now() }
      // ② the suggestion was acted on: count the adoption for adaptive thresholds.
      if (meta.suggest[sigId]) meta.suggest[sigId].adopted = (meta.suggest[sigId].adopted || 0) + 1
      saveMeta()
    }

    // B3: when one error signature keeps recurring, auto-generate a prefilled
    // draft (marked 待确认) so the recurring problem becomes an entry without
    // waiting for a human to notice the inbox. A draft is only useful if it can
    // be promoted: it carries the captured error text and the fix evidence.
    const AUTO_DRAFT_AT = 3
    async function autoDraft(sigId, count, query, topTitle) {
      meta.drafted ||= {}
      if (meta.drafted[sigId]) return
      // A signature the library already answers needs no draft.
      if (libraryCoversSignature({ id: sigId })) return
      meta.drafted[sigId] = Date.now()
      saveMeta()
      const evidence = meta.inbox
        .filter(i => (i.cls || 'knowledge') === 'knowledge' && signatureWeight(String(i.message || '').toLowerCase()).id === sigId)
        .sort((a, b) => (b.fix ? 1 : 0) - (a.fix ? 1 : 0) || (b.repeat || 1) - (a.repeat || 1))
      const sample = String((meta.signatureFreq[sigId] || {}).sample || query || '').trim()
      const symptomLines = []
      if (sample) symptomLines.push(`- 报错原文：\`${sample}\``)
      symptomLines.push(`- 错误签名：\`${sigId}\`（已出现 ${count} 次）`)
      symptomLines.push(`- 最近一次查询：\`${query}\``)
      for (const e of evidence.slice(0, 3)) symptomLines.push(`- 采集到的现场：${String(e.message || '').slice(0, 220)}`)
      if (topTitle) symptomLines.push(`- 当前最相关条目：${topTitle}`)
      const withFix = evidence.find(e => e.fix && String(e.fix).trim())
      const keywords = [sigId, sample, ...String(query || '').split(/\s+/).filter(Boolean).slice(0, 6)].filter(Boolean)
      const body = buildEntryMarkdown({
        title: `待定：${sigId} 反复出现（待认领）`,
        source: `经验库自动采集（错误签名 ${sigId} 复发 ${count} 次）→ 待确认`,
        summary: '由经验库在错误签名反复出现时自动起草；补全「原因 / 避坑」后用 experience_promote 认领入库。',
        symptom: symptomLines.join('\n'),
        cause: '',
        fix: withFix ? '```\n' + withFix.fix + '\n```' : '',
        keywords,
      })
      try {
        await mkdir(DRAFTS_DIR, { recursive: true })
        await writeFile(join(DRAFTS_DIR, `auto-${sigId}.md`), body)
      } catch { /* ignore */ }
    }

    // ②: a no-match query is the cheapest signal that the library has a gap.
    function recordMiss(query) {
      const hit = meta.missed.find(m => m.query === query)
      if (hit) { hit.count = (hit.count || 1) + 1; hit.lastTs = Date.now() }
      else meta.missed.push({ query, count: 1, ts: Date.now(), lastTs: Date.now() })
      if (meta.missed.length > 50) meta.missed = meta.missed.slice(-50)
    }

    // `quiet` runs a read-only lookup for the proactive surfacing hook: no
    // counters, no signature heat, no draft, no resolve context.
    function search(rawQuery, limit, quiet) {
      const q = String(rawQuery || '').trim().toLowerCase()
      if (!quiet) { lastQuery = q.slice(0, 200); meta.search.total++ }
      if (!q) { if (!quiet) saveMeta(); return { hits: [], suggest: false, topScore: 0 } }
      const sig = signatureWeight(q)
      const sigW = sig.weight
      let sigFreqBoost = 0
      let sigId = ''
      let sigCount = 0
      if (sig.id) {
        sigId = sig.id
        const rec = meta.signatureFreq[sig.id] || { count: 0, lastTs: 0 }
        if (!quiet) {
          rec.count++
          rec.lastTs = Date.now()
          rec.sample = q.slice(0, 120)
          meta.signatureFreq[sig.id] = rec
        }
        sigFreqBoost = repeatBoost(rec.count, rec.lastTs)
        sigCount = rec.count
      }
      const primary = q.split(/\s+/).filter(Boolean)
      // A3: expand each primary token with synonyms at half weight.
      const tokens = []
      for (const t of primary) {
        tokens.push({ t, w: 1 })
        for (const a of (ALIASES[t] || [])) if (!primary.includes(a)) tokens.push({ t: a, w: 0.5 })
      }
      const resolveFor = sigId ? meta.resolveMap[sigId] : null
      const scored = []
      for (const item of index) {
        const text = item.text.toLowerCase()
        const title = (item.title + ' ' + item.rel).toLowerCase()
        let score = 0
        let matched = 0
        let hitCount = 0
        let bodyIdx = -1
        const z = item.zones || {}
        for (const { t, w } of tokens) {
          const ti = title.indexOf(t)
          const bi = text.indexOf(t)
          if (ti >= 0) { score += Math.round(20 * w); matched++; if (w === 1) hitCount++ }
          else if (bi >= 0) { score += Math.round(10 * w); matched++; if (w === 1) hitCount++; if (bodyIdx < 0) bodyIdx = bi }
          else {
            const grams = bigramsOf(t)
            if (grams.length) {
              let hitG = 0
              for (const g of grams) {
                const inBody = text.indexOf(g)
                if (inBody >= 0) { hitG++; if (bodyIdx < 0) bodyIdx = inBody; continue }
                if (title.indexOf(g) >= 0) hitG++
              }
              if (hitG > 0) {
                score += Math.round((hitG === grams.length ? 8 : Math.max(2, Math.round(hitG * 4 / grams.length))) * w)
                matched++
                if (w === 1) hitCount++
              }
            }
          }
          // A1: a match in the high-signal sections outranks a prose match.
          if (z.kw && z.kw.indexOf(t) >= 0) score += Math.round(8 * w)
          else if (z.fix && z.fix.indexOf(t) >= 0) score += Math.round(5 * w)
        }
        if (matched === 0) continue
        if (hitCount === primary.length) score += 30
        score += sigW * 8
        score += sigFreqBoost
        // ① severity: a critical entry outranks an equivalent non-critical hit.
        const sevBoost = SEVERITY_BOOST[(item.meta && item.meta.severity) || '']
        if (sevBoost) score += sevBoost
        // B4: a file already read right after this signature was searched is a
        // known resolver — boost it when the same mistake recurs, net of misses.
        if (resolveFor && resolveFor[item.rel]) {
          const rr = resolveFor[item.rel]
          const net = (rr.count || 0) - (rr.miss || 0)
          if (net > 0) score += Math.min(12, net * 4)
        }
        const conf = confidenceOf(item.rel)
        score = Math.round(score * (0.5 + Math.max(0, conf) * 0.5))
        scored.push({ item, score, firstIdx: bodyIdx })
      }
      scored.sort((a, b) => b.score - a.score || a.item.rel.localeCompare(b.item.rel))
      // A2: near-duplicate entries must not both sit at the top; the lower-ranked
      // twin of an overlap pair is down-weighted and the list re-sorted once.
      if (Object.keys(similarMap).length) {
        const pos = new Map(scored.map((s, i) => [s.item.rel, i]))
        for (const s of scored) {
          const twins = similarMap[s.item.rel]
          if (!twins) continue
          const here = pos.get(s.item.rel)
          for (const t of twins) {
            const there = pos.get(t)
            if (there !== undefined && there < here) { s.score = Math.round(s.score * 0.6); break }
          }
        }
        scored.sort((a, b) => b.score - a.score || a.item.rel.localeCompare(b.item.rel))
      }
      // A4: two-stage — refine the coarse top with precision signals (whole-query
      // phrase presence, title coverage) before the final slice.
      const pool = scored.slice(0, 15)
      if (pool.length > 1) {
        for (const s of pool) {
          const tl = (s.item.title + ' ' + s.item.rel).toLowerCase()
          let overlap = 0
          for (const t of primary) if (tl.indexOf(t) >= 0) overlap++
          const frac = primary.length ? overlap / primary.length : 0
          const phrase = s.item.text.toLowerCase().indexOf(q) >= 0 ? 40 : 0
          s.score = Math.round(s.score * (1 + 0.6 * frac) + phrase)
        }
        pool.sort((a, b) => b.score - a.score || a.item.rel.localeCompare(b.item.rel))
        scored.splice(0, pool.length, ...pool)
      }
      const topScore = scored.length ? scored[0].score : 0
      let hits = scored.slice(0, Math.max(1, Number(limit) || 5)).map(({ item, firstIdx }) => ({
        rel: item.rel, title: item.title, snippet: makeSnippet(item.text, firstIdx, item.title), itemMeta: item.meta,
      }))
      if (!quiet) for (const h of hits) {
        const st = meta.stats[h.rel] || {}
        st.hitCount = (st.hitCount || 0) + 1
        meta.stats[h.rel] = st
      }
      let suggest = false
      if (hits.length === 0) {
        // A2: fuzzy semantic fallback — full-query bigrams vs file bigrams (Jaccard).
        const qgrams = bigramsOf(q)
        if (qgrams.length) {
          const qset = new Set(qgrams)
          const fz = []
          for (const item of index) {
            const ig = new Set(bigramsOf((item.title + item.text.slice(0, 600)).toLowerCase()))
            let inter = 0
            for (const g of qset) if (ig.has(g)) inter++
            const union = qset.size + ig.size - inter
            const j = union ? inter / union : 0
            if (j >= 0.15) fz.push({ item, score: Math.round(j * 100), firstIdx: -1 })
          }
          fz.sort((a, b) => b.score - a.score)
          hits = fz.slice(0, Math.max(1, Number(limit) || 5)).map(({ item, score }) => ({
            rel: item.rel, title: item.title,
            snippet: `[模糊匹配 ${score}%] ${firstParagraph(item.text).slice(0, 120)}`,
            itemMeta: item.meta, fuzzy: true,
          }))
        }
        if (hits.length === 0) {
          suggest = true
          if (!quiet) { meta.search.noMatch++; recordMiss(q) }
        }
      }
      if (!quiet) {
        saveMeta()
        // B4: remember the signature this search was about and what it hit, so a
        // following read of one of those hits records the association.
        if (sigId && hits.length) lastSearch = { sigId, rels: new Set(hits.map(h => h.rel)), ts: Date.now() }
        // B3: a signature that keeps recurring earns a prefilled draft.
        if (sigId && sigCount >= AUTO_DRAFT_AT) autoDraft(sigId, sigCount, q, hits[0] && hits[0].title).catch(() => {})
      }
      return { hits: hits.map(enrichHit), suggest, topScore }
    }

    // ②: the library's own backlog — recurring signatures with no confirmed
    // resolver, plus queries that found nothing.
    const GAP_MIN = 2
    // A mistake the library ALREADY answers must not be reported as a gap.
    // read-as-click alone under-reports (it needs a search-then-read pair, in
    // order), so an exact in-library hit also counts as coverage.
    // Coverage v2 (strict). Only a KNOWN error signature is eligible, and it
    // counts as covered only when some entry actually writes that signature's
    // own text (diagnostics-keywords section first, then the whole entry).
    // Unknown errors are never "covered" — they stay in the inbox for a human.
    // v1 searched the whole message and accepted any non-fuzzy top hit, which
    // matched nearly everything (it silently pruned two real problems).
    function libraryCoversSignature(sig) {
      if (!sig || !sig.id) return false
      const S = SIGNATURES.find(x => x.id === sig.id)
      if (!S) return false
      return index.some(it => {
        const kw = zoneText(it.text, '诊断关键词')
        return S.re.test(kw) || S.re.test(it.text)
      })
    }
    function inboxCovered(item) {
      return libraryCoversSignature(signatureWeight(String((item && item.message) || '').toLowerCase()))
    }

    // Drafts are files in .drafts/. Before this scan they had no read path at
    // all — no route, no panel entry, no tool — so a generated draft was
    // invisible forever. This is what makes 已起稿待认领 visible, and what
    // decides whether a draft still deserves a promotion (usage/config classes
    // are already answered by the discipline docs).
    async function draftsData() {
      let names = []
      try { names = (await readdir(DRAFTS_DIR)).filter(n => n.endsWith('.md')).sort() } catch { return [] }
      const out = []
      for (const name of names) {
        let text = ''
        try { text = await readFile(join(DRAFTS_DIR, name), 'utf8') } catch { continue }
        const sig = draftSignature(name, text)
        const fmBlock = (String(text).match(/^\s*<!--([\s\S]*?)-->/) || [, ''])[1]
        const date = (fmBlock.match(/date:\s*([0-9-]+)/) || [, ''])[1]
        const source = ((fmBlock.match(/source:\s*([^;]+)/) || [, ''])[1] || '').trim()
        const symptom = draftSymptom(text)
        const cls = classifyFailure(symptom || String(text).slice(0, 400)).cls
        const covered = sig ? libraryCoversSignature({ id: sig }) : false
        out.push({
          file: name, date, source: source.slice(0, 120), signature: sig,
          count: (meta.signatureFreq[sig] || {}).count || 0,
          cls, covered, promotable: cls === 'knowledge' && !covered,
        })
      }
      return out
    }

    // Drafts whose signature is covered, or that are usage/config-class, are
    // dead weight: move them into .drafts/archive/ (never delete) so the
    // 待认领 list only holds actionable drafts.
    async function archiveStaleDrafts() {
      let names = []
      try { names = (await readdir(DRAFTS_DIR)).filter(n => n.endsWith('.md')) } catch { return 0 }
      let moved = 0
      for (const name of names) {
        let text = ''
        try { text = await readFile(join(DRAFTS_DIR, name), 'utf8') } catch { continue }
        const sig = draftSignature(name, text)
        const cls = classifyFailure(draftSymptom(text) || String(text).slice(0, 400)).cls
        const covered = sig ? libraryCoversSignature({ id: sig }) : false
        if (cls === 'knowledge' && !covered) continue
        try {
          await mkdir(join(DRAFTS_DIR, 'archive'), { recursive: true })
          await rename(join(DRAFTS_DIR, name), join(DRAFTS_DIR, 'archive', name))
          moved += 1
        } catch { /* ignore */ }
      }
      return moved
    }

    async function gapsData() {
      const drafts = await draftsData()
      const signatures = Object.entries(meta.signatureFreq).map(([id, r]) => {
        const resolvers = Object.keys(meta.resolveMap[id] || {})
        const count = r.count || 0
        // Pass an object carrying `id`: libraryCoversSignature() returns false
        // for anything without one, so handing it the raw freq record made
        // `entryCovered` permanently false and gaps never discounted signatures
        // the library already answers.
        const entryCovered = resolvers.length === 0 ? libraryCoversSignature({ id, sample: r.sample }) : false
        const draft = drafts.find(d => d.signature === id)
        return { id, count, resolvers: resolvers.length, resolverRels: resolvers, sample: r.sample || '', entryCovered, draft: draft ? draft.file : '', gap: count >= GAP_MIN && resolvers.length === 0 && !entryCovered }
      }).sort((a, b) => b.count - a.count)
      const missed = meta.missed.slice().sort((a, b) => (b.count || 1) - (a.count || 1)).slice(0, 10)
      const open = meta.inbox.filter(i => !i.covered && (i.cls || 'knowledge') === 'knowledge').length
      const parked = meta.inbox.length - open
      const lines = []
      const gaps = signatures.filter(s => s.gap)
      if (gaps.length) {
        lines.push('【最该补的经验】反复出现、但库里还没有已确认解法：')
        for (const s of gaps.slice(0, 8)) lines.push(`- ${s.id} × ${s.count}`)
      }
      const pending = drafts.filter(d => d.promotable)
      if (pending.length) {
        lines.push('', '【已起稿 · 待认领】草稿已生成，补全后用 experience_promote 入库：')
        for (const d of pending.slice(0, 8)) lines.push(`- ${d.file}${d.signature ? `（签名 ${d.signature} × ${d.count}）` : ''}`)
      }
      if (open) lines.push('', `【候选池】${open} 条待整理${parked ? `（另有 ${parked} 条用法类/已覆盖，可归档）` : ''}`)
      if (missed.length) {
        lines.push('', '【检索未命中（候选新经验）】')
        for (const m of missed) lines.push(`- ${m.query} × ${m.count || 1}`)
      }
      if (!lines.length) lines.push('暂无缺口：没有"高频复发且无解法"的签名，也没有未命中记录。')
      return { signatures: signatures.slice(0, 20), missed, drafts, inbox: { total: meta.inbox.length, open, parked }, report: lines.join('\n') }
    }

    // ── gap → entry: promote ──
    // Turns a draft (or a bare signature/query) into a real library entry:
    // validates the category, applies the template, refuses near-duplicates,
    // keeps the category README index in sync, deletes the claimed draft and
    // rebuilds the index — so the next experience_gaps call reflects the new
    // coverage instead of leaving the loop at "draft generated".
    const CATEGORIES = LIBRARIES.flatMap(l => l.dirs)

    async function promote(rawArgs) {
      const body = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
      const category = String(body.category || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
      if (!CATEGORIES.includes(category)) return { ok: false, error: `category must be one of: ${CATEGORIES.join(', ')}` }
      const title = String(body.title || '').trim()
      if (!title) return { ok: false, error: 'missing title' }

      let draftFile = ''
      const rawDraft = String(body.draft || '').trim().replace(/\\/g, '/')
      if (rawDraft) {
        draftFile = rawDraft.split('/').pop()
        if (!draftFile.endsWith('.md')) draftFile += '.md'
        try { await access(join(DRAFTS_DIR, draftFile)) } catch { return { ok: false, error: `draft not found: .drafts/${draftFile}` } }
      }
      let draftText = ''
      if (draftFile) { try { draftText = await readFile(join(DRAFTS_DIR, draftFile), 'utf8') } catch { /* ignore */ } }

      const warnings = []
      let sigId = String(body.signature || '').trim()
      if (!sigId && draftFile) sigId = draftSignature(draftFile, draftText)
      if (sigId && !SIGNATURES.some(s => s.id === sigId)) {
        warnings.push(`未知签名 ${sigId}：只作为诊断关键词写入，不计入缺口消解`)
        sigId = ''
      }
      let sample = String(body.sample || '').trim()
      if (!sample && sigId) sample = String((meta.signatureFreq[sigId] || {}).sample || '').trim()
      if (!sample && sigId) sample = SIGNATURE_SAMPLE[sigId] || ''
      if (!sample && draftText) {
        const sm = draftText.match(/报错原文：`([^`]+)`/)
        if (sm) sample = String(sm[1]).trim().slice(0, 200)
      }
      if (!sigId && sample) {
        const guessed = signatureWeight(sample.toLowerCase()).id
        if (guessed) sigId = guessed
      }

      const keywords = []
      const addKw = (v) => {
        for (const part of String(v == null ? '' : v).split(/[\n,]/)) {
          const t = part.trim().slice(0, 120)
          if (t && !keywords.some(k => k.toLowerCase() === t.toLowerCase())) keywords.push(t)
        }
      }
      if (Array.isArray(body.keywords)) { for (const k of body.keywords) addKw(k) } else addKw(body.keywords)
      if (sample) addKw(sample)
      if (sigId) addKw(sigId)
      // Do NOT mine extra words out of the symptom text: the diagnostics-keywords
      // section is the +8 weighting surface, and auto-picked prose words
      // ("could", "city") dilute it. Curated keywords + the error sample only.
      while (keywords.length > 14) keywords.pop()

      const symptom = String(body.symptom || '').trim() || (draftText ? draftSymptom(draftText) : '')
      const cause = String(body.cause || '').trim()
      const fix = String(body.fix || '').trim()
      const missing = missingSections({ symptom, cause, fix })
      if (missing.length) warnings.push(`空小节：${missing.join(' / ')}（检索与 experience_ask 会退化）`)
      if (draftText && classifyFailure(draftSymptom(draftText)).cls !== 'knowledge') {
        warnings.push('该草稿的症状属于用法/配置类：按 CONTRIBUTING 不该入库，先确认 00-global/03 是否已覆盖')
      }

      const markdown = buildEntryMarkdown({
        title,
        date: body.date,
        source: body.source || `经验库认领（${draftFile || sigId || '手动'}）`,
        summary: body.summary,
        symptom,
        cause,
        fix,
        keywords,
        severity: body.severity,
        dshVersion: body.dshVersion,
      })

      const similar = findSimilar(index, markdown, 25, 5)
      const blocking = similar.filter(s => s.score >= 45)
      if (blocking.length && body.force !== true) {
        return { ok: false, error: '与库内条目高度重叠：先合并进已有条目，或传 force:true', similar: blocking }
      }
      if (sigId && libraryCoversSignature({ id: sigId })) warnings.push(`签名 ${sigId} 已被库内条目覆盖：确认是补充旧条目而不是重复新增`)

      const wantFile = String(body.file || '').trim().replace(/\\/g, '/')
      let file = wantFile ? basename(wantFile) : (slugify(title) || sigId || `entry-${new Date().toISOString().slice(0, 10)}`)
      file = file.replace(/[<>:"|?*]/g, '-')
      if (!file.toLowerCase().endsWith('.md')) file += '.md'
      const rel = `${category}/${file}`
      const full = join(ROOT, category, file)
      const exists = await access(full).then(() => true, () => false)
      if (exists && body.force !== true) return { ok: false, error: `file exists: ${rel}（换 file 或传 force:true）` }

      const readmeFull = join(ROOT, category, 'README.md')
      let readmeText = ''
      try { readmeText = await readFile(readmeFull, 'utf8') } catch { /* no README */ }
      const row = buildReadmeRow(file, title)
      const ins = readmeText ? insertReadmeRow(readmeText, row, file) : { inserted: false, reason: 'no README' }
      if (readmeText && !ins.inserted && ins.reason && ins.reason !== 'already listed') {
        warnings.push(`分类 README 未自动更新（${ins.reason}）：请手工补一行 ${row}`)
      }

      if (body.dryRun === true) {
        const coveredEstimate = Boolean(sigId && (libraryCoversSignature({ id: sigId }) || SIGNATURES.find(s => s.id === sigId).re.test(markdown)))
        const out = { ok: true, dryRun: true, rel, markdown, similar, readmeRow: row, readmeWouldInsert: ins.inserted, warnings }
        if (sigId) { out.signature = sigId; out.signatureCovered = coveredEstimate }
        return out
      }

      await mkdir(dirname(full), { recursive: true })
      await writeFile(full, markdown)
      if (ins.inserted) await writeFile(readmeFull, ins.text)
      if (draftFile) { try { await unlink(join(DRAFTS_DIR, draftFile)) } catch { /* ignore */ } }
      if (sigId) { meta.promoted[sigId] = { rel, ts: Date.now() } }
      await rebuild()
      stamp = await computeStamp()
      saveMeta()

      const out = { ok: true, rel, draftRemoved: Boolean(draftFile), readmeInserted: Boolean(ins.inserted), warnings, similar }
      if (sigId) { out.signature = sigId; out.signatureCovered = libraryCoversSignature({ id: sigId }) }
      return out
    }

    // ── HTTP endpoints ──
    const json = (res, obj, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(obj))
    }
    const readBody = (req) => new Promise((resolveBody, reject) => {
      let data = ''
      req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('body too large')); req.destroy() } })
      req.on('end', () => resolveBody(data))
      req.on('error', reject)
    })

    if (webServer) {
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/list', handler: (req, res) => json(res, { ok: true, ...catalog }) }))
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/search', handler: (req, res) => {
        const url = new URL(req.url, 'http://internal')
        const q = (url.searchParams.get('q') || '').trim()
        if (!q) return json(res, { ok: false, error: 'missing q' }, 400)
        json(res, { ok: true, ...search(q, url.searchParams.get('limit')) })
      }}))
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/read', handler: async (req, res) => {
        const url = new URL(req.url, 'http://internal')
        const p = (url.searchParams.get('path') || '').trim()
        if (!p) return json(res, { ok: false, error: 'missing path' }, 400)
        const full = resolve(ROOT, p)
        if (full !== ROOT && !full.startsWith(ROOT + sep)) return json(res, { ok: false, error: 'outside root' }, 403)
        try {
          const text = await readFile(full, 'utf8')
          const st = meta.stats[p] || {}
          st.readCount = (st.readCount || 0) + 1
          meta.stats[p] = st
          noteRead(p)
          saveMeta()
          json(res, { ok: true, path: p, text, meta: { readCount: st.readCount, confidence: confidenceOf(p) } })
        } catch (err) {
          json(res, { ok: false, error: String((err && err.message) || err) }, 404)
        }
      }}))
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/refresh', handler: async (req, res) => {
        const r = await rebuild()
        stamp = await computeStamp()
        json(res, r)
      }}))
      // inbox
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/inbox', handler: (req, res) => {
        if (req.method === 'POST') {
          readBody(req).then((b) => {
            let d = {}
            try { d = JSON.parse(b) } catch { /* ignore */ }
            addInbox(d.kind || 'manual', d.message || d.context || '(空)')
            json(res, { ok: true, inbox: meta.inbox })
          }).catch((e) => json(res, { ok: false, error: e.message }, 400))
        } else {
          json(res, { ok: true, inbox: meta.inbox })
        }
      }}))
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/inbox/draft', handler: async (req, res) => {
        const url = new URL(req.url, 'http://internal')
        const id = url.searchParams.get('id')
        const item = meta.inbox.find(i => i.id === id)
        if (!item) return json(res, { ok: false, error: 'inbox item not found' }, 404)
        const draft = [
          `<!-- date: ${new Date().toISOString().slice(0, 10)}; source: 经验库错误采集 → 待确认 -->`,
          `# <待定标题：${item.message.slice(0, 40)}>`,
          '',
          '> 由经验库自动采集生成的草稿，请补充「症状 / 原因 / 避坑 / 诊断关键词」后移入正式分类。',
          '',
          '## 症状',
          '',
          item.message,
          item.tool ? `- 工具：\`${item.tool}\`` : null,
          item.query ? `- 当时查询：\`${item.query}\`` : null,
          item.repeat > 1 ? `- 复发：${item.repeat} 次` : null,
          '',
          '## 原因',
          '',
          '（待补充）',
          '',
          '## 避坑（可复制）',
          '',
          item.fix ? '```\n' + item.fix + '\n```' : '（待补充）',
          '',
          '## 诊断关键词',
          '',
          `- ${item.message.split(/\s+/)[0] || ''}`,
          '',
        ].filter(l => l !== null).join('\n')
        try {
          await writeFile(join(DRAFTS_DIR, `draft-${id}.md`), draft)
          meta.inbox = meta.inbox.filter(i => i.id !== id)
          saveMeta()
          json(res, { ok: true, path: join(DRAFTS_DIR, `draft-${id}.md`).replaceAll('\\', '/') })
        } catch (err) {
          json(res, { ok: false, error: String(err && err.message || err) }, 500)
        }
      }}))
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/inbox/dismiss', handler: async (req, res) => {
        const url = new URL(req.url, 'http://internal')
        const id = url.searchParams.get('id')
        meta.inbox = meta.inbox.filter(i => i.id !== id)
        saveMeta()
        json(res, { ok: true, inbox: meta.inbox })
      }}))
      // L3 dedup + C4/C5 flag + A6 stats
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/dedup', handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405)
        const b = await readBody(req).catch(() => '')
        let d = {}
        try { d = JSON.parse(b) } catch { /* ignore */ }
        const hay = String((d.title || '') + ' ' + (d.text || '')).toLowerCase()
        const hset = new Set(bigramsOf(hay))
        const scored = []
        for (const item of index) {
          const ig = new Set(bigramsOf((item.title + item.text.slice(0, 500)).toLowerCase()))
          let inter = 0
          for (const g of hset) if (ig.has(g)) inter++
          const union = hset.size + ig.size - inter
          const j = union ? inter / union : 0
          if (j >= 0.25) scored.push({ rel: item.rel, title: item.title, score: Math.round(j * 100) })
        }
        scored.sort((a, b) => b.score - a.score)
        json(res, { ok: true, similar: scored.slice(0, 5) })
      }}))
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/flag', handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405)
        const b = await readBody(req).catch(() => '')
        let d = {}
        try { d = JSON.parse(b) } catch { /* ignore */ }
        const p = String(d.path || '').trim()
        if (!p) return json(res, { ok: false, error: 'missing path' }, 400)
        const conf = (typeof meta.confidence[p] === 'number' ? meta.confidence[p] : 1) - 0.2
        meta.confidence[p] = Math.max(-1, conf)
        const issue = String(d.issue || '标记有误').slice(0, 200)
        const line = `- ${new Date().toISOString().slice(0, 10)} · ${p} · 置信度降至 ${meta.confidence[p].toFixed(1)} · ${issue}`
        try {
          await writeFile(join(ROOT, 'FEEDBACK.md'), `\n${line}\n`, { flag: 'a' })
        } catch { /* ignore */ }
        saveMeta()
        json(res, { ok: true, confidence: meta.confidence[p] })
      }}))
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/stats', handler: (req, res) => {
        const total = meta.search.total || 0
        json(res, {
          ok: true,
          search: { total, noMatch: meta.search.noMatch || 0, noMatchRate: total ? Math.round((meta.search.noMatch || 0) / total * 100) : 0 },
          topRead: Object.entries(meta.stats).map(([rel, s]) => ({ rel, ...s })).sort((a, b) => (b.readCount || 0) - (a.readCount || 0)).slice(0, 10),
          topSignatures: Object.entries(meta.signatureFreq).map(([id, r]) => ({ id, count: r.count || 0, lastTs: r.lastTs || 0 })).sort((a, b) => b.count - a.count).slice(0, 10),
          topResolvers: Object.entries(meta.resolveMap).map(([id, m]) => ({ id, rels: Object.keys(m).length })).sort((a, b) => b.rels - a.rels).slice(0, 10),
          inboxCount: meta.inbox.length,
          suppressedCount: meta.suppressed || 0,
          criticalCount: index.filter(it => it.meta && it.meta.severity === 'critical').length,
          // Long tail in two precise buckets. readCount only counts an
          // experience_read of the full entry, so 'readCount === 0' alone is
          // NOT 'unused': auto-surfaced hits and direct file reads never
          // touch it. Entries under a subdirectory only (root docs excluded).
          neverOpened: (() => { const s = meta.stats; return index.filter(it => { const v = s[it.rel]; return it.rel.indexOf('/') > 0 && v && (v.hitCount || 0) > 0 && !((v.readCount || 0) > 0) }).map(it => ({ rel: it.rel, title: it.title, hits: (s[it.rel].hitCount || 0) })).sort((a, b) => b.hits - a.hits).slice(0, 60) })(),
          dormant: (() => { const s = meta.stats; return index.filter(it => { const v = s[it.rel]; return it.rel.indexOf('/') > 0 && !((v && v.hitCount) > 0) && !((v && v.readCount) > 0) }).map(it => ({ rel: it.rel, title: it.title })).slice(0, 60) })(),
          suggest: (() => {
            const rows = Object.entries(meta.suggest).map(([id, s]) => ({ id, pushed: s.pushed || 0, adopted: s.adopted || 0, failed: s.failed || 0 }))
            const sum = (k) => rows.reduce((a, r) => a + r[k], 0)
            const pushed = sum('pushed'), adopted = sum('adopted'), failed = sum('failed')
            return { pushed, adopted, failed, adoptionRate: pushed ? Math.round(adopted / pushed * 100) : 0, top: rows.sort((a, b) => b.pushed - a.pushed).slice(0, 10) }
          })(),
          verified: Object.entries(meta.verify).filter(([, v]) => Object.values(v.results).every(Boolean)).length,
          failed: Object.entries(meta.verify).filter(([, v]) => Object.values(v.results).some(x => !x)).length,
        })
      }}))
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/gaps', handler: async (req, res) => {
        json(res, { ok: true, ...(await gapsData()) })
      }}))
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/drafts', handler: async (req, res) => {
        json(res, { ok: true, drafts: await draftsData() })
      }}))
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/promote', handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405)
        const b = await readBody(req).catch(() => '')
        let d = {}
        try { d = JSON.parse(b) } catch { /* ignore */ }
        const r = await promote(d)
        json(res, r, r.ok ? 200 : 400)
      }}))
      // Missed queries are maintenance data: a garbage or one-off query must be
      // removable, otherwise the "未命中" list only ever grows and never tells
      // the truth about what the library is missing.
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/missed/dismiss', handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, { ok: false, error: 'POST only' }, 405)
        const b = await readBody(req).catch(() => '')
        let d = {}
        try { d = JSON.parse(b) } catch { /* ignore */ }
        const q = String(d.query || '').trim()
        const before = meta.missed.length
        meta.missed = q ? meta.missed.filter(m => m.query !== q) : []
        const removed = before - meta.missed.length
        if (removed) {
          meta.search.noMatch = Math.max(0, (meta.search.noMatch || 0) - removed)
          await saveMeta()
        }
        json(res, { ok: true, removed, missed: meta.missed })
      }}))
      // 归档（不是删除）：把"已由库内条目覆盖"或"用法/配置类（00-global/03 已覆盖）"
      // 的候选移出候选池，写进 meta.inboxArchive（上限 300，可追溯）。之前只给
      // covered 打标记却仍留在候选池里，面板看起来永远清不完。
      ctx.effect(() => webServer.register({ kind: 'exact', path: '/experience/inbox/prune', handler: async (req, res) => {
        const url = new URL(req.url, 'http://internal')
        const only = (url.searchParams.get('cls') || '').trim()
        const kept = []
        const archived = []
        for (const it of meta.inbox) {
          const cls = it.cls || classifyFailure(it.message).cls
          if (cls !== 'knowledge') it.cls = cls
          const covered = inboxCovered(it)
          const reason = cls !== 'knowledge'
            ? `${cls} 类：工具用法/配置问题，已由纪律或配置文档覆盖`
            : (covered ? '库内已有条目覆盖' : '')
          const shouldArchive = only
            ? (only === 'covered' ? covered : cls === only)
            : Boolean(reason)
          if (shouldArchive) {
            archived.push({ ...it, archivedAt: Date.now(), archivedReason: reason, covered: covered || it.covered === true })
          } else {
            if (it.covered === undefined) it.covered = covered
            kept.push(it)
          }
        }
        meta.inbox = kept
        meta.inboxArchive = [...(meta.inboxArchive || []), ...archived].slice(-300)
        const draftsArchived = await archiveStaleDrafts()
        await saveMeta()
        json(res, {
          ok: true,
          archived: archived.length,
          draftsArchived,
          archivedTotal: meta.inboxArchive.length,
          open: meta.inbox.filter(it => !it.covered && (it.cls || 'knowledge') === 'knowledge').length,
          remaining: meta.inbox.length,
          covered: archived.slice(0, 20).map(it => ({ id: it.id, message: String(it.message || '').slice(0, 90), reason: it.archivedReason })),
        })
      }}))
    }

    // ── agent tools ──
    if (tools) {
      const hitsSchema = {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            rel: { type: 'string', required: true },
            title: { type: 'string', required: true },
            snippet: { type: 'string', required: true },
            readCount: { type: 'integer' },
            confidence: { type: 'number' },
            stale: { type: 'boolean' },
            date: { type: 'string' },
            dshVersion: { type: 'string' },
            severity: { type: 'string' },
            verified: { type: 'boolean' },
          },
        },
      }
      const hitLine = (h) => {
        const flags = []
        if (h.severity === 'critical') flags.push('⚠ 最高危险')
        if (h.stale) flags.push('可能过时')
        if (typeof h.confidence === 'number' && h.confidence < 0.5) flags.push(`置信度${h.confidence.toFixed(1)}`)
        if (h.verified === false) flags.push('验证未通过')
        return `- ${h.rel} :: ${h.title}${flags.length ? ' [' + flags.join(',') + ']' : ''}\n  ${h.snippet}`
      }

      ctx.effect(() => tools.register(defineTool({
        name: 'experience_search',
        description: '在 DSH 经验库中搜索踩坑经验、指南与模板。查询支持空格分词（多词 AND 加权、标题命中加权）；中文整句自动做 2-gram 模糊匹配；已知报错签名（ERR_MODULE_NOT_FOUND/EPERM/Access denied/Error NNN 等）自动加权。索引自动刷新。返回匹配文件路径、摘要与元数据（阅读量/置信度/是否可能过时）。用 experience_read 读全文。',
        parameters: {
          query: { type: 'string', required: true, description: '关键词或问题描述（支持空格分词与中文模糊）' },
          limit: { type: 'number', description: '返回条数，默认 5' },
        },
        output: {
          schema: {
            type: 'object', additionalProperties: false,
            properties: { ok: { type: 'boolean', required: true }, hits: hitsSchema, suggest: { type: 'boolean' } },
          },
          render(args, value) {
            if (!value.ok) return [{ type: 'text', text: 'experience_search failed' }]
            const lines = value.hits.map(hitLine)
            const text = lines.length ? lines.join('\n') : 'no matches'
            const tail = value.suggest ? '\n\n（未命中：库中可能缺少这类经验。可向经验库提交候选：POST /experience/inbox，或按 experience/README.md 新增流程补充。）' : ''
            return [{ type: 'text', text: text + tail }]
          },
        },
        async execute(args) {
          const r = search(args.query, args.limit)
          return { ok: true, hits: r.hits, suggest: r.suggest }
        },
      })))
      ctx.effect(() => tools.register(defineTool({
        name: 'experience_read',
        description: '读取 DSH 经验库中一个经验文件的全文。路径用 experience_search 返回的 rel 字段。',
        parameters: { path: { type: 'string', required: true, description: '经验文件相对路径' } },
        output: {
          schema: {
            type: 'object', additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true }, path: { type: 'string' }, text: { type: 'string' },
              readCount: { type: 'integer' }, confidence: { type: 'number' }, error: { type: 'string' },
            },
          },
          render(args, value) {
            return [{ type: 'text', text: value.ok ? value.text : ('experience_read failed: ' + (value.error || '')) }]
          },
        },
        async execute(args) {
          const p = String(args.path || '').trim()
          const full = resolve(ROOT, p)
          if (full !== ROOT && !full.startsWith(ROOT + sep)) return { ok: false, error: 'outside root' }
          try {
            const text = await readFile(full, 'utf8')
            const st = meta.stats[p] || {}
            st.readCount = (st.readCount || 0) + 1
            meta.stats[p] = st
            noteRead(p)
            saveMeta()
            return { ok: true, path: p, text, readCount: st.readCount, confidence: confidenceOf(p) }
          } catch (err) {
            return { ok: false, error: String((err && err.message) || err) }
          }
        },
      })))
      // A3: aggregated answer (structured, zero-LLM by default).
      ctx.effect(() => tools.register(defineTool({
        name: 'experience_ask',
        description: '针对一个问题综合经验库给出结构化答案：检索 top 命中 → 汇总各文件的结论（症状/原因/避坑要点）并标注来源路径。适合"给结论而非文件列表"的场景；比 experience_search 更省后续阅读。',
        parameters: { query: { type: 'string', required: true, description: '问题描述' } },
        output: {
          schema: {
            type: 'object', additionalProperties: false,
            properties: { ok: { type: 'boolean', required: true }, answer: { type: 'string' }, sources: { type: 'array', items: { type: 'string' } } },
          },
          render(args, value) {
            return [{ type: 'text', text: value.ok ? value.answer : ('experience_ask failed: ' + value.error) }]
          },
        },
        async execute(args) {
          const r = search(String(args.query || ''), 3)
          if (!r.hits.length) return { ok: true, answer: '经验库未命中。可补充经验或换关键词。', sources: [] }
          const blocks = []
          const sources = []
          for (const h of r.hits) {
            sources.push(h.rel)
            let text = ''
            try { text = await readFile(resolve(ROOT, h.rel), 'utf8') } catch { /* ignore */ }
            const grab = (label) => {
              const m = text.match(new RegExp(`##\\s*${label}[\\s\\S]{0,600}?(?=\\n##\\s|$)`))
              return m ? m[0].replace(/^##\s.*\n/, '').replace(/\s+/g, ' ').trim().slice(0, 400) : ''
            }
            const sym = grab('症状')
            const cause = grab('原因')
            const fix = grab('避坑')
            blocks.push(`【${h.title}】(${h.rel})${h.stale ? ' [可能过时]' : ''}\n- 症状: ${sym || '—'}\n- 原因: ${cause || '—'}\n- 避坑: ${fix || h.snippet}`)
          }
          return { ok: true, answer: blocks.join('\n\n'), sources }
        },
      })))
      ctx.effect(() => tools.register(defineTool({
        name: 'experience_gaps',
        description: '列出经验库的缺口：反复出现但还没有对应经验条目的错误签名、已起草待认领的草稿、检索未命中的查询。用来决定下一步该补写哪条经验（认领草稿用 experience_promote）。',
        parameters: {},
        output: {
          schema: {
            type: 'object', additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              report: { type: 'string' },
              gaps: { type: 'array', items: { type: 'string' } },
              drafts: { type: 'array', items: { type: 'string' } },
            },
          },
          render(args, value) { return [{ type: 'text', text: value.report || '(empty)' }] },
        },
        async execute() {
          const d = await gapsData()
          const pending = d.drafts.filter(x => x.promotable).map(x => `${x.file}${x.signature ? `（签名 ${x.signature} × ${x.count}）` : ''}`)
          return { ok: true, report: d.report, gaps: d.signatures.filter(s => s.gap).map(s => `${s.id} × ${s.count}`), drafts: pending }
        },
      })))
      // The missing half of the loop: drafts could be created but never became
      // entries. This is the only writing tool; it fills the template, refuses
      // near-duplicates, keeps the category README in sync, removes the claimed
      // draft and rebuilds the index so gaps reflect the new coverage.
      ctx.effect(() => tools.register(defineTool({
        name: 'experience_promote',
        description: '把经验库缺口变成正式条目：认领 .drafts 草稿（或直接按签名写入），按模板落盘到指定分类、自动查重、同步分类 README、删除草稿并重建索引，返回该签名是否已被覆盖。解决完一个问题后立刻沉淀时用。先 experience_gaps 看缺口/草稿。',
        parameters: {
          category: { type: 'string', required: true, description: '目标分类目录，如 04-diagnosis-methodology / 06-shell-tooling' },
          title: { type: 'string', required: true, description: '一句话标题（会进索引）' },
          symptom: { type: 'string', description: '症状：报错原文/可观察现象' },
          cause: { type: 'string', description: '原因：根因链，精确到机制' },
          fix: { type: 'string', description: '避坑（可复制）：能直接执行的命令/配置/代码' },
          keywords: { type: 'array', items: { type: 'string' }, description: '诊断关键词（每行一个词/短语）' },
          draft: { type: 'string', description: '要认领的草稿文件名（.drafts 下），如 auto-conn-reset.md' },
          signature: { type: 'string', description: '错误签名 id，如 conn-reset（自动带出报错原文并计入覆盖）' },
          sample: { type: 'string', description: '签名对应的报错原文' },
          file: { type: 'string', description: '目标文件名（默认由标题生成）' },
          summary: { type: 'string', description: '标题下的一句话概述' },
          severity: { type: 'string', description: 'critical / high（可选）' },
          dryRun: { type: 'boolean', description: '只预览 markdown 与查重结果，不落盘' },
          force: { type: 'boolean', description: '跳过重复/同名覆盖检查' },
        },
        output: {
          schema: {
            type: 'object', additionalProperties: false,
            properties: {
              ok: { type: 'boolean', required: true },
              error: { type: 'string' },
              rel: { type: 'string' },
              dryRun: { type: 'boolean' },
              markdown: { type: 'string' },
              readmeRow: { type: 'string' },
              readmeWouldInsert: { type: 'boolean' },
              readmeInserted: { type: 'boolean' },
              draftRemoved: { type: 'boolean' },
              signature: { type: 'string' },
              signatureCovered: { type: 'boolean' },
              warnings: { type: 'array', items: { type: 'string' } },
              similar: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false,
                  properties: { rel: { type: 'string', required: true }, title: { type: 'string', required: true }, score: { type: 'integer', required: true } },
                },
              },
            },
          },
          render(args, value) {
            if (!value.ok) {
              const sim = (value.similar || []).map(s => `- ${s.rel}（重叠 ${s.score}%）`).join('\n')
              return [{ type: 'text', text: `experience_promote failed: ${value.error || ''}${sim ? '\n' + sim : ''}` }]
            }
            const lines = []
            if (value.dryRun) {
              lines.push(`[dryRun] 将写入 ${value.rel}`)
              lines.push(value.markdown || '')
              if (value.readmeRow) lines.push(`README 行：${value.readmeWouldInsert ? '会自动插入' : '需手工补'} ${value.readmeRow}`)
            } else {
              lines.push(`已写入 ${value.rel}${value.draftRemoved ? '，草稿已移除' : ''}${value.readmeInserted ? '，README 已更新' : '，README 未自动更新'}`)
              if (value.signature) lines.push(`签名 ${value.signature}：${value.signatureCovered ? '已被库内条目覆盖（缺口消除）' : '仍未覆盖'}`)
            }
            if (value.warnings && value.warnings.length) lines.push('警告：\n- ' + value.warnings.join('\n- '))
            if (value.similar && value.similar.length) lines.push('相近条目：\n' + value.similar.map(s => `- ${s.rel}（重叠 ${s.score}%）`).join('\n'))
            return [{ type: 'text', text: lines.join('\n') }]
          },
        },
        async execute(args) { return promote(args) },
      })))
    }

    // ── ① proactive surfacing ──
    // When a tool fails, look the error up and inject the matching entry's
    // 症状/避坑 into the conversation, so a known fix appears without the agent
    // remembering to search. Same seam as dsh-repeat-tool-reminder:
    // tools/post-execute + additionalContexts.
    const SURFACE_MIN = 55
    const surfaced = new Set()
    const sigIdOf = (text) => signatureWeight(String(text || '').toLowerCase()).id
    function errorTextOf(result) {
      if (result.error && result.error.message) return String(result.error.message)
      if (Array.isArray(result.content)) return result.content.filter(b => b && b.type === 'text').map(b => b.text).join(' ')
      return ''
    }
    function sectionOf(text, label, max = 300) {
      const m = text.match(new RegExp(`##\\s*${label}[\\s\\S]{0,${max * 3}}?(?=\\n##\\s|$)`))
      return m ? m[0].replace(/^##\s.*\n/, '').replace(/\s+/g, ' ').trim().slice(0, max) : ''
    }
    ctx.on('tools/post-execute', async (exec, result, next) => {
      const downstream = await next()
      try {
        if (!result || result.isError !== true) return downstream
        const name = (exec && exec.name) || ''
        if (name.startsWith('experience_')) return downstream
        const errText = errorTextOf(result)
        if (!errText) return downstream
        const key = (name + '|' + errText).slice(0, 200)
        if (surfaced.has(key)) return downstream
        // ② adaptive threshold: a signature whose past pushes were adopted is
        // pushed more readily; one that never helped raises its own bar.
        const sigId = sigIdOf(errText)
        const sg = (sigId && meta.suggest[sigId]) || {}
        const eff = (sg.adopted || 0) / ((sg.adopted || 0) + (sg.failed || 0) + 1)
        const minScore = Math.round(SURFACE_MIN * (1.2 - 0.6 * eff))
        const r = search(errText, 1, true)
        const h = r.hits[0]
        if (!h || (r.topScore || 0) < minScore) return downstream
        if (surfaced.size > 200) surfaced.clear()
        surfaced.add(key)
        if (sigId) {
          const s = meta.suggest[sigId] || (meta.suggest[sigId] = { pushed: 0, adopted: 0, failed: 0, lastTs: 0 })
          s.pushed++
          s.lastTs = Date.now()
          saveMeta()
        }
        let body = ''
        try { body = await readFile(resolve(ROOT, h.rel), 'utf8') } catch { /* ignore */ }
        const text = `【经验库命中】${h.title}（${h.rel}）\n- 症状: ${sectionOf(body, '症状') || '—'}\n- 避坑: ${sectionOf(body, '避坑') || h.snippet}\n如需全文：experience_read path="${h.rel}"`
        const notice = {
          id: crypto.randomUUID(),
          role: 'user',
          content: [{ type: 'text', text }],
          source: { kind: 'dsh-experience', form: 'notice', summary: `经验库命中 ${h.rel}` },
        }
        const extra = downstream && Array.isArray(downstream.additionalContexts) ? downstream.additionalContexts : []
        return { ...(downstream || {}), additionalContexts: [notice, ...extra] }
      } catch { return downstream }
    })
  },
}
