// dsh-experience/lib/promote.js — pure helpers for the "gap → entry" loop.
// No I/O here on purpose: index.js does the reading/writing, this module only
// decides *what* to write, so the rules can be unit-tested without a host.

// ── failure classification ───────────────────────────────────────────────────
// The inbox used to treat every tool failure as a knowledge gap. In practice
// most of them are operation-discipline mistakes already answered by
// `00-global/03-file-tool-discipline.md`: they must not generate drafts, must
// not count as library gaps, and must not inflate the "最该补的经验" list.
// `knowledge` is the only class that can become an entry.
const FAILURE_RULES = [
  { re: /file has not been read|requires reading .*first/i, cls: 'usage', reason: 'edit/write 前没 read（fs-observation）' },
  { re: /file changed since it was read|file no longer exists/i, cls: 'usage', reason: '观察状态失效：改前重新 read' },
  { re: /old_string (?:was not found|matched \d+ times)/i, cls: 'usage', reason: 'old_string 不存在或不唯一' },
  { re: /offset \d+ is out of range|offset must be a positive integer/i, cls: 'usage', reason: 'read 的 offset 越界/非法' },
  { re: /missing required property|invalid arguments|requires a justification/i, cls: 'usage', reason: '工具参数缺失或非法' },
  { re: /cannot read .*:(?: binary file| not a regular file| not found)/i, cls: 'usage', reason: '读文件方式/路径不对' },
  { re: /unknown job|no active im delivery consumer|approval for escalating .* was cancelled|tool call aborted/i, cls: 'usage', reason: '任务/审批状态失效，重试即可' },
  { re: /glob search failed|grep (?:failed|produced more raw output)/i, cls: 'usage', reason: '检索范围过宽或输出爆上限' },
  // 2026-10-28: the first triage pass left these in the "待整理" pool; they are
  // all operation/state mistakes, not missing knowledge.
  { re: /unknown tool\b/i, cls: 'usage', reason: '工具名不存在（模型幻觉，先查工具目录）' },
  { re: /belongs to another parent session/i, cls: 'usage', reason: '子代理归属错误：不要跨会话操作' },
  { re: /rejected escalating this command|user rejected escalating/i, cls: 'usage', reason: '用户拒绝提权：停下解释，别绕过' },
  { re: /这个会话没有绑定任何|not bound to any (?:wechat|qq) (?:conversation|chat)/i, cls: 'usage', reason: '渠道会话未绑定：先让用户发一条消息' },
  { re: /no adapter registered for provider|no adapter for provider/i, cls: 'config', reason: 'providers 未注册对应适配器（插件/配置）' },
  { re: /(?:api key required|api key is not configured|requires the .* api key|no apitoken|no api key)/i, cls: 'config', reason: '外部服务未配置密钥（环境问题，不是经验缺口）' },
  { re: /multiple usable web providers are registered|configure one explicitly/i, cls: 'config', reason: '插件/服务配置冲突' },
  { re: /transport failed|HTTPSConnection|Unable to download webpage|Unable to extract initial state/i, cls: 'config', reason: '网络/出口问题（先查代理与站点风控）' },
  { re: /HTTP 412|rate-limit(?:ed|ing)|too many requests/i, cls: 'config', reason: '站点限流/风控（4xx），退避后再试' },
]

// A model or provider refusing a request (401/402/403/412/429) is a
// configuration or quota state, not a missing experience entry.
const CONFIG_STATUS = /(?:^|\D)(?:401|402|403|412|429)(?:\D|$)/

export function classifyFailure(message) {
  const text = String(message || '')
  for (const rule of FAILURE_RULES) {
    if (rule.re.test(text)) return { cls: rule.cls, reason: rule.reason }
  }
  if (CONFIG_STATUS.test(text)) return { cls: 'config', reason: '鉴权/配额状态码（4xx），检查配置' }
  return { cls: 'knowledge', reason: '' }
}

// ── slug ────────────────────────────────────────────────────────────────────
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uAC00-\uD7AF]/

export function slugify(title) {
  const out = []
  for (const ch of String(title || '').toLowerCase()) {
    if (/[a-z0-9]/.test(ch) || CJK_RE.test(ch)) out.push(ch)
    else out.push('-')
  }
  return out.join('').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

// ── entry markdown ──────────────────────────────────────────────────────────
// Mirrors 99-templates/experience.md.template: front-matter on line 1 (the
// parser only reads the first comment block), fixed section names, and the
// diagnostics-keywords section that retrieval weights up.
const SECTION_PLACEHOLDER = '（待补充）'

function cleanInline(value) {
  return String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/-->/g, '—>').trim()
}

function sectionBody(value) {
  const text = String(value == null ? '' : value).replace(/\r\n/g, '\n').trim()
  return text || SECTION_PLACEHOLDER
}

export function buildEntryMarkdown(opts = {}) {
  const title = cleanInline(opts.title).replace(/\s+/g, ' ')
  const date = String(opts.date || new Date().toISOString().slice(0, 10)).slice(0, 32)
  const source = cleanInline(opts.source).replace(/;+/g, '，').slice(0, 160)
  const fm = [`date: ${date}`, `source: ${source || '经验库 promote'}`]
  if (opts.severity) fm.push(`severity: ${cleanInline(opts.severity).slice(0, 16)}`)
  if (opts.dshVersion) fm.push(`dshVersion: ${cleanInline(opts.dshVersion).slice(0, 32)}`)

  const lines = [`<!-- ${fm.join('; ')} -->`, `# ${title}`, '']
  const summary = cleanInline(opts.summary)
  if (summary) lines.push(`> ${summary}`, '')
  lines.push(
    '## 症状', '', sectionBody(opts.symptom), '',
    '## 原因', '', sectionBody(opts.cause), '',
    '## 避坑（可复制）', '', sectionBody(opts.fix), '',
    '## 诊断关键词', '',
  )
  const seen = new Set()
  for (const raw of Array.isArray(opts.keywords) ? opts.keywords : []) {
    const k = cleanInline(raw).replace(/\s+/g, ' ').slice(0, 120)
    if (!k || seen.has(k.toLowerCase())) continue
    seen.add(k.toLowerCase())
    lines.push(`- ${k}`)
  }
  if (!seen.size) lines.push('- ' + title)
  lines.push('')
  return lines.join('\n')
}

export function missingSections(opts = {}) {
  const missing = []
  if (!cleanInline(opts.symptom)) missing.push('症状')
  if (!cleanInline(opts.cause)) missing.push('原因')
  if (!cleanInline(opts.fix)) missing.push('避坑')
  return missing
}

// ── similarity (dedup gate) ─────────────────────────────────────────────────
// index.js's own bigramsOf() only keeps CJK pairs, so it scores 0 for English
// content. Promotion must catch "this entry already exists" in both languages,
// so this shingle set carries CJK bigrams *and* ASCII word tokens.
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'when', 'then', 'than', 'not', 'are', 'was', 'has', 'have', 'but', 'you', 'your', 'its', 'into', 'out', 'can', 'will', 'may', '一个', '这个', '那个', '就是', '可以', '如果', '因为', '所以', '已经', '没有', '不是'])

export function shingles(text) {
  const s = String(text || '').toLowerCase()
  const out = new Set()
  for (let i = 0; i < s.length - 1; i += 1) {
    if (CJK_RE.test(s[i]) && CJK_RE.test(s[i + 1])) out.add(s.slice(i, i + 2))
  }
  for (const w of s.match(/[a-z][a-z0-9_.-]{2,}/g) || []) {
    if (!STOPWORDS.has(w)) out.add(w)
  }
  return out
}

export function jaccard(a, b) {
  if (!a || !b || !a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  return inter / (a.size + b.size - inter)
}

// `entries` is [{rel,title,text}]. Returns the top matches as percentages.
export function findSimilar(entries, text, minScore = 25, limit = 5) {
  const target = shingles(text)
  if (!target.size) return []
  const out = []
  for (const it of entries || []) {
    const score = Math.round(jaccard(target, shingles(`${it.title}\n${String(it.text || '').slice(0, 800)}`)) * 100)
    if (score >= minScore) out.push({ rel: it.rel, title: it.title, score })
  }
  out.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel))
  return out.slice(0, limit)
}

// ── category README index row ──────────────────────────────────────────────
export function buildReadmeRow(file, title) {
  const safe = String(title || file).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim().slice(0, 160)
  return `| [\`${file}\`](${file}) | ${safe} |`
}

// Inserts one row at the end of the table under `## 本目录文件`. Returns
// { inserted, text, reason } and never mutates the input string. If the
// category README has no such table the caller must update it by hand (the
// returned `reason` says so).
export function insertReadmeRow(readmeText, row, file) {
  const text = String(readmeText || '')
  if (!text) return { inserted: false, text, reason: 'no README' }
  if (file && text.includes(`](${file})`)) return { inserted: false, text, reason: 'already listed' }

  const heading = /^##\s*本目录文件\s*$/m.exec(text)
  if (!heading) return { inserted: false, text, reason: 'no 本目录文件 section' }
  const sectionStart = heading.index + heading[0].length
  const rest = text.slice(sectionStart)
  const nextHeading = /^##\s/m.exec(rest)
  const sectionEnd = sectionStart + (nextHeading ? nextHeading.index : rest.length)

  const section = text.slice(sectionStart, sectionEnd)
  const lines = section.split('\n')
  let lastTableLine = -1
  let sawTable = false
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*\|/.test(lines[i])) { sawTable = true; lastTableLine = i }
    else if (sawTable && lines[i].trim() !== '') break
  }
  if (!sawTable) return { inserted: false, text, reason: 'no table in section' }

  lines.splice(lastTableLine + 1, 0, row)
  const nextText = text.slice(0, sectionStart) + lines.join('\n') + text.slice(sectionEnd)
  return { inserted: true, text: nextText, reason: '' }
}

// ── draft metadata ─────────────────────────────────────────────────────────
// Drafts are plain .md files in .drafts/. Their signature is recoverable from
// the filename (`auto-<sigId>.md`) or the source line (`签名 <id>`), which is
// all the draft list needs to decide whether the draft is still worth
// promoting.
export function draftSignature(name, text) {
  const fromName = String(name || '').match(/^auto-(.+)\.md$/)
  if (fromName) return fromName[1]
  const fromSource = String(text || '').match(/签名\s*([A-Za-z][A-Za-z0-9-]+)/)
  return fromSource ? fromSource[1] : ''
}

export function draftSymptom(text) {
  const body = String(text || '')
  const m = /##\s*症状[\s\S]*?(?=##\s|$)/.exec(body)
  if (!m) return ''
  return m[0].replace(/^##\s*症状[^\n]*\n/, '').trim().slice(0, 240)
}
