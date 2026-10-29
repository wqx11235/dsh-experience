// Host-free integration harness for the draft → entry loop.
// Stages the current plugin source with a stub @deepseek-ai/dsh-tools, drives
// it with a fake Cordis context, and runs the promotion pipeline against a
// throwaway library root.
//
//   node test/host-harness.mjs
//
// Exits non-zero if any check fails.
import { mkdir, writeFile, readFile, rm, access, cp, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyFailure } from '../lib/promote.js'

const STAGE = resolve('test/.stage')
const TMP = resolve('test/.tmp-lib')

let failures = 0
let HAS_REAL_TOOLS = false
function check(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`) } else { failures += 1; console.log(`  FAIL ${name}${detail ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`) }
}

async function stage() {
  await rm(STAGE, { recursive: true, force: true })
  await mkdir(join(STAGE, 'lib'), { recursive: true })
  await mkdir(join(STAGE, 'library'), { recursive: true })
  await mkdir(join(STAGE, 'node_modules/@deepseek-ai/dsh-tools'), { recursive: true })
  await cp(resolve('index.js'), join(STAGE, 'index.js'))
  await cp(resolve('lib/promote.js'), join(STAGE, 'lib/promote.js'))
  // Minimal packaged starter library, used to exercise first-run seeding.
  await writeFile(join(STAGE, 'library/README.md'), '# starter\n')
  await writeFile(join(STAGE, 'library/10-starter.md'), '<!-- date: 2026-10-01; source: test -->\n# Starter entry\n\n## 症状\n\n- seeded\n')
  await writeFile(join(STAGE, 'node_modules/@deepseek-ai/dsh-tools/package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-tools', version: '0.0.0-test', type: 'module', main: 'index.js' }))
  // Prefer the host's REAL defineTool (schema compilation + strict arg checks);
  // fall back to a pass-through stub so the pipeline still runs on a clean
  // checkout / CI where the DSH packages are not installed.
  const realTools = await findDshTools()
  if (realTools) {
    HAS_REAL_TOOLS = true
    await writeFile(join(STAGE, 'node_modules/@deepseek-ai/dsh-tools/index.js'), [
      `export { defineTool } from ${JSON.stringify(pathToFileURL(realTools).href)}`,
      '',
    ].join('\n'))
    console.log(`dsh-tools: ${realTools} (real schema validation)`)
  } else {
    await writeFile(join(STAGE, 'node_modules/@deepseek-ai/dsh-tools/index.js'), 'export function defineTool(def) { return def }\n')
    console.log('dsh-tools: not found, using pass-through stub (schema validation skipped)')
  }
}

async function findDshTools() {
  // DSH_TOOLS_STUB=1 forces the CI path even on a machine that has the host
  // packages installed (keeps local and CI behaviour comparable).
  if (process.env.DSH_TOOLS_STUB === '1') return ''
  const candidates = [
    process.env.DSH_TOOLS_ENTRY,
    '../../node_modules/@deepseek-ai/dsh-tools/lib/index.js',
    join(homedir(), '.dsh', 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
  ].filter(Boolean)
  for (const c of candidates) {
    const p = resolve(c)
    try { await access(p); return p } catch { /* next */ }
  }
  return ''
}

function makeCtx() {
  const tools = new Map()
  const routes = new Map()
  const handlers = {}
  const noop = () => () => {}
  const ctx = {
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
    interval: noop,
    timeout: noop,
    on: (ev, fn) => { handlers[ev] = fn; return () => {} },
    webServer: { register: ({ path, handler }) => { routes.set(path, handler); return () => {} } },
    tools: { register: (tool) => { tools.set(tool.name, tool); return () => {} } },
  }
  return { ctx, tools, routes, handlers }
}

function makeReq(method, url, body) {
  const listeners = { data: [], end: [], error: [] }
  const req = {
    method,
    url,
    on(ev, fn) {
      (listeners[ev] || (listeners[ev] = [])).push(fn)
      if (ev === 'end') {
        setImmediate(() => {
          if (body) for (const f of listeners.data) f(body)
          for (const f of listeners.end) f()
        })
      }
      return req
    },
    destroy() {},
  }
  return req
}

async function callRoute(routes, path, opts = {}) {
  const handler = routes.get(path)
  if (!handler) throw new Error(`route missing: ${path}`)
  const req = makeReq(opts.method || 'GET', opts.url || path, opts.body)
  let status = 200
  let payload = ''
  const res = { writeHead(s) { status = s }, end(b) { payload = b || '' } }
  await handler(req, res)
  let parsed = null
  try { parsed = payload ? JSON.parse(payload) : null } catch { parsed = payload }
  return { status, body: parsed }
}

async function seed() {
  await rm(TMP, { recursive: true, force: true })
  const write = async (rel, text) => {
    const full = join(TMP, rel)
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, text)
  }
  await write('README.md', '# 测试经验库\n\n> 临时根目录，仅用于 promote 流水线的集成测试。\n')
  await write('00-global/README.md', [
    '# 00 · 全局',
    '',
    '## 本目录文件',
    '',
    '| 文件 | 内容 |',
    '| --- | --- |',
    '| [`03-file-tool-discipline.md`](03-file-tool-discipline.md) | 工具用法纪律 |',
    '',
  ].join('\n'))
  await write('00-global/03-file-tool-discipline.md', [
    '<!-- date: 2026-09-10; source: 测试 -->',
    '# 文件与检索工具的用法纪律',
    '',
    '## 症状',
    '',
    '- `fetch failed` / `ECONNRESET`',
    '',
    '## 诊断关键词',
    '',
    '- fetch failed',
    '- ECONNRESET',
    '',
  ].join('\n'))
  await write('06-shell-tooling/README.md', [
    '# 06 · shell',
    '',
    '## 本目录文件',
    '',
    '| 文件 | 内容 |',
    '| --- | --- |',
    '| [`01-existing.md`](01-existing.md) | 已有条目 |',
    '',
    '## 一句话总结',
    '',
    '- 测试用',
    '',
  ].join('\n'))
  await write('06-shell-tooling/01-existing.md', '<!-- date: 2026-10-01; source: 测试 -->\n# 已有条目\n\n## 症状\n\n- 无\n')
  await write('05-runtime-and-process/README.md', '# 05 · 运行\n\n## 本目录文件\n\n| 文件 | 内容 |\n| --- | --- |\n')
  // covered draft: the library already answers conn-reset, so this draft is
  // stale by definition and must NOT be offered as 待认领.
  await write('.drafts/auto-conn-reset.md', [
    '<!-- date: 2026-10-21; source: 经验库自动采集（错误签名 conn-reset 复发 3 次）→ 待确认 -->',
    '# 待定：conn-reset 反复出现（待认领）',
    '',
    '## 症状',
    '',
    '- 报错原文：`fetch failed econnrefused`',
    '',
  ].join('\n'))
  // uncovered draft: this is the one that must be promotable.
  await write('.drafts/auto-error-nnn.md', [
    '<!-- date: 2026-10-22; source: 经验库自动采集（错误签名 error-nnn 复发 4 次）→ 待确认 -->',
    '# 待定：error-nnn 反复出现（待认领）',
    '',
    '## 症状',
    '',
    '- 报错原文：`Error 1730`',
    '',
  ].join('\n'))
  await write('.drafts/draft-usage.md', [
    '<!-- date: 2026-10-21; source: 经验库错误采集 → 待确认 -->',
    '# 待定：edit failed',
    '',
    '## 症状',
    '',
    'tool edit failed: cannot modify "x": file has not been read — read the file, then retry',
    '',
  ].join('\n'))
  const now = Date.now()
  await write('.meta.json', JSON.stringify({
    stats: {}, confidence: {}, verify: {},
    search: { total: 10, noMatch: 2 },
    inbox: [
      { id: 'u1', ts: now - 2000, kind: 'tool-error', message: 'tool edit failed: cannot modify "x": file has not been read — read the file, then retry', repeat: 2, tool: 'edit' },
      { id: 'k1', ts: now - 1000, kind: 'tool-error', message: 'tool web_fetch failed: fetch failed ECONNRESET', repeat: 1, tool: 'web_fetch' },
    ],
    signatureFreq: {
      'conn-reset': { count: 3, lastTs: now, sample: 'fetch failed econnrefused' },
      'error-nnn': { count: 4, lastTs: now, sample: 'Error 1730' },
    },
    drafted: { 'conn-reset': now - 86400000, 'error-nnn': now - 7200000 },
    resolveMap: {},
    missed: [{ query: '0x80045040', count: 1, ts: now, lastTs: now }, { query: 'garbled-bytes', count: 1, ts: now, lastTs: now }],
    fixes: [],
  }, null, 2))
}

await stage()
await seed()
const mod = await import(pathToFileURL(join(STAGE, 'index.js')).href)
const { ctx, tools, routes } = makeCtx()
await mod.default.apply(ctx, { experienceRoot: TMP })

console.log('== routes/tools ==')
check('gaps route', routes.has('/experience/gaps'))
check('drafts route', routes.has('/experience/drafts'))
check('promote route', routes.has('/experience/promote'))
check('missed dismiss route', routes.has('/experience/missed/dismiss'))
check('promote tool', tools.has('experience_promote'))

console.log('== failure classes (noise must not look like knowledge) ==')
check('unknown tool → usage', classifyFailure('tool read_page failed: unknown tool "read_page"').cls === 'usage')
check('rejected escalation → usage', classifyFailure('the user rejected escalating this command to "danger-full-access"').cls === 'usage')
check('unbound channel → usage', classifyFailure('这个会话没有绑定任何微信对话，无法发送').cls === 'usage')
check('HTTP 412 → config', classifyFailure('tool video_probe failed: HTTP 412: the site rate-limited this request').cls === 'config')
check('no adapter → config', classifyFailure('no adapter registered for provider "deepseek-vision"').cls === 'config')
check('yt-dlp network fail → config', classifyFailure('yt-dlp exited 1: ERROR: Unable to download webpage: HTTPSConnection').cls === 'config')
check('real crash stays knowledge', classifyFailure("AttributeError: type object 'HydraRenderEngine' has no attribute 'bl_idname'").cls === 'knowledge')
check('ordinary failure stays knowledge', classifyFailure('tool fetch failed: ECONNRESET').cls === 'knowledge')

console.log('== gaps: coverage + drafts ==')
const gaps1 = await callRoute(routes, '/experience/gaps')
const sigCovered = (gaps1.body.signatures || []).find(s => s.id === 'conn-reset')
const sigOpen = (gaps1.body.signatures || []).find(s => s.id === 'error-nnn')
check('covered signature flagged', sigCovered && sigCovered.entryCovered === true && sigCovered.gap === false, sigCovered)
check('open signature stays a gap', sigOpen && sigOpen.entryCovered === false && sigOpen.gap === true, sigOpen)
check('draft list has all three drafts', (gaps1.body.drafts || []).length === 3, gaps1.body.drafts)
const dCovered = (gaps1.body.drafts || []).find(d => d.file === 'auto-conn-reset.md')
const dOpen = (gaps1.body.drafts || []).find(d => d.file === 'auto-error-nnn.md')
const dUsage = (gaps1.body.drafts || []).find(d => d.file === 'draft-usage.md')
check('covered draft not offered', dCovered && dCovered.promotable === false && dCovered.covered === true, dCovered)
check('open draft promotable', dOpen && dOpen.promotable === true && dOpen.signature === 'error-nnn' && dOpen.count === 4, dOpen)
check('usage draft not promotable', dUsage && dUsage.promotable === false && dUsage.cls === 'usage', dUsage)
check('draft date/source parsed cleanly', dOpen && dOpen.date === '2026-10-22' && !/-->/.test(dOpen.source) && dOpen.source.length < 80, dOpen)
check('report lists the open draft', /已起稿[\s\S]*auto-error-nnn\.md/.test(gaps1.body.report || ''), gaps1.body.report)

const promoteBody = {
  category: '06-shell-tooling',
  title: 'MSI 安装报 Error 1730：缺管理员权限',
  symptom: '- 安装包双击后回滚，日志 `Error 1730`\n- 无 UAC 弹窗',
  cause: '- MSI 的 InstallValidate 要求管理员权限，非提权进程直接被拒',
  fix: '```powershell\n# 用 UAC 提权再装\nStart-Process msiexec -ArgumentList \'/i\',\'setup.msi\' -Verb RunAs\n```',
  draft: 'auto-error-nnn.md',
  signature: 'error-nnn',
  sample: 'Error 1730',
  keywords: ['msiexec', 'UAC'],
}

console.log('== promote dryRun ==')
const before = await readdir(join(TMP, '06-shell-tooling'))
const dry = await callRoute(routes, '/experience/promote', { method: 'POST', body: JSON.stringify({ ...promoteBody, dryRun: true }) })
check('dryRun ok', dry.body && dry.body.ok === true && dry.body.dryRun === true, dry.body)
check('dryRun renders template', /## 症状[\s\S]*## 原因[\s\S]*## 避坑（可复制）[\s\S]*## 诊断关键词/.test(dry.body.markdown || ''), dry.body && dry.body.markdown)
check('dryRun has front matter first', /^<!-- date: \d{4}-\d{2}-\d{2}; source: /.test(dry.body.markdown || ''), dry.body && dry.body.markdown)
check('dryRun would insert README row', dry.body.readmeWouldInsert === true, dry.body)
check('dryRun predicts coverage', dry.body.signatureCovered === true, dry.body)
const afterDry = await readdir(join(TMP, '06-shell-tooling'))
check('dryRun writes nothing', afterDry.length === before.length, { before, afterDry })
const kwDry = await callRoute(routes, '/experience/promote', {
  method: 'POST',
  body: JSON.stringify({ category: '06-shell-tooling', title: '关键词不挖散词', symptom: '- could not geocode location city nearby', dryRun: true }),
})
const kwSection = String(kwDry.body.markdown || '').split('## 诊断关键词')[1] || ''
check('no prose words mined into keywords', !/\n- (could|city|nearby|location)\b/.test(kwSection), kwSection)

console.log('== promote for real ==')
const real = await callRoute(routes, '/experience/promote', { method: 'POST', body: JSON.stringify(promoteBody) })
check('promote ok', real.body && real.body.ok === true && real.body.signatureCovered === true, real.body)
const rel = real.body && real.body.rel
const written = rel ? await readFile(join(TMP, rel), 'utf8').catch(() => '') : ''
check('entry written with sections', /## 症状/.test(written) && /## 诊断关键词/.test(written) && /Error 1730/.test(written), written.slice(0, 200))
check('front matter on line 1', /^<!-- date: \d{4}-\d{2}-\d{2}; source: /.test(written), written.slice(0, 80))
check('README row inserted', /\]\(.*\.md\)/.test(await readFile(join(TMP, '06-shell-tooling/README.md'), 'utf8')) && /Error 1730/.test(await readFile(join(TMP, '06-shell-tooling/README.md'), 'utf8')))
check('draft removed after promotion', await access(join(TMP, '.drafts/auto-error-nnn.md')).then(() => false, () => true))
const gaps2 = await callRoute(routes, '/experience/gaps')
const sigAfter = (gaps2.body.signatures || []).find(s => s.id === 'error-nnn')
check('signature now covered', sigAfter && sigAfter.entryCovered === true && sigAfter.gap === false, sigAfter)
check('promoted draft no longer listed', !(gaps2.body.drafts || []).some(d => d.file === 'auto-error-nnn.md'), gaps2.body.drafts)

console.log('== dedup gate ==')
const dup = await callRoute(routes, '/experience/promote', {
  method: 'POST',
  body: JSON.stringify({ category: '05-runtime-and-process', title: 'MSI 安装报 Error 1730：缺管理员权限', symptom: '- 安装包双击后回滚，日志 `Error 1730`', cause: '- MSI 的 InstallValidate 要求管理员权限', fix: 'Start-Process msiexec -Verb RunAs' }),
})
check('near duplicate refused', dup.body && dup.body.ok === false && /重叠/.test(dup.body.error || ''), dup.body)
const forced = await callRoute(routes, '/experience/promote', {
  method: 'POST',
  body: JSON.stringify({ category: '05-runtime-and-process', title: 'MSI 安装报 Error 1730：缺管理员权限', symptom: '- 日志 `Error 1730`', cause: '- 权限不足', fix: 'RunAs', force: true }),
})
check('force bypasses dedup', forced.body && forced.body.ok === true, forced.body)

console.log('== bad input ==')
const bad = await callRoute(routes, '/experience/promote', { method: 'POST', body: JSON.stringify({ category: '../etc', title: 'x' }) })
check('unknown category refused', bad.body && bad.body.ok === false && /category must be/.test(bad.body.error || ''), bad.body)
const bad2 = await callRoute(routes, '/experience/promote', { method: 'POST', body: JSON.stringify({ category: '06-shell-tooling', title: 'x', draft: 'nope.md' }) })
check('missing draft refused', bad2.body && bad2.body.ok === false && /draft not found/.test(bad2.body.error || ''), bad2.body)

console.log('== inbox prune ==')
const pr = await callRoute(routes, '/experience/inbox/prune')
check('archives usage + covered', pr.body && pr.body.archived === 2 && pr.body.remaining === 0, pr.body)
check('stale drafts archived', pr.body && pr.body.draftsArchived === 2, pr.body)
const leftDrafts = (await readdir(join(TMP, '.drafts'))).filter(n => n.endsWith('.md'))
check('no actionable drafts left in .drafts', leftDrafts.length === 0, leftDrafts)
const archivedDrafts = await readdir(join(TMP, '.drafts/archive')).catch(() => [])
check('draft archive keeps copies', archivedDrafts.length === 2, archivedDrafts)
const meta = JSON.parse(await readFile(join(TMP, '.meta.json'), 'utf8'))
check('archive keeps evidence', (meta.inboxArchive || []).length === 2 && meta.inboxArchive.every(x => x.archivedReason), meta.inboxArchive)

console.log('== missed dismiss ==')
const dis = await callRoute(routes, '/experience/missed/dismiss', { method: 'POST', body: JSON.stringify({ query: 'garbled-bytes' }) })
check('dismiss removes one', dis.body && dis.body.removed === 1 && dis.body.missed.length === 1, dis.body)
const meta2 = JSON.parse(await readFile(join(TMP, '.meta.json'), 'utf8'))
check('noMatch decremented', meta2.search.noMatch === 1, meta2.search)

console.log('== tools: gaps output shape ==')
const gapsTool = await tools.get('experience_gaps').execute({})
check('gaps tool returns drafts array', Array.isArray(gapsTool.drafts) && !gapsTool.drafts.some(d => /error-nnn/.test(d)), gapsTool)

console.log('== tools: promote execute + schema ==')
const toolDry = await tools.get('experience_promote').execute({ category: '06-shell-tooling', title: '工具直调预览', symptom: '- s', dryRun: true })
check('tool dryRun returns valid output', toolDry && toolDry.ok === true && toolDry.dryRun === true, toolDry)
let rejected = false
try { await tools.get('experience_promote').execute({ category: '06-shell-tooling' }) } catch (err) { rejected = /invalid arguments/.test(String(err && err.message)) }
if (HAS_REAL_TOOLS) check('tool rejects missing title', rejected)
else console.log('  skip tool rejects missing title (stub has no arg validation)')

console.log('== first-run seeding ==')
const seedRoot = resolve('test/.tmp-seed')
await rm(seedRoot, { recursive: true, force: true })
await mod.default.apply(makeCtx().ctx, { experienceRoot: seedRoot })
check('seeded file exists', await access(join(seedRoot, '10-starter.md')).then(() => true, () => false))
check('seeded README exists', await access(join(seedRoot, 'README.md')).then(() => true, () => false))
check('existing library untouched', await access(join(TMP, '10-starter.md')).then(() => false, () => true))
const seedOffRoot = resolve('test/.tmp-seed-off')
await rm(seedOffRoot, { recursive: true, force: true })
await mod.default.apply(makeCtx().ctx, { experienceRoot: seedOffRoot, seed: false })
check('seed:false disables copying', await access(join(seedOffRoot, '10-starter.md')).then(() => false, () => true))

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
