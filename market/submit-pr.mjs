// Open the awesome-dsh-plugin listing PR: fork -> branch -> one YAML file -> PR.
// Token comes from GH_TOKEN (never printed).
import { readFile } from 'node:fs/promises'

const token = process.env.GH_TOKEN
const H = {
  Authorization: 'Bearer ' + token,
  'User-Agent': 'dsh-agent',
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}
const UP = 'awesome-dsh-plugin/awesome-dsh-plugin'
const OWNER = 'wqx11235'
const REPO = 'awesome-dsh-plugin'
const BRANCH = 'add-dsh-experience'
const PATH = 'data/plugins/wqx11235__dsh-experience.yml'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function api(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : 'https://api.github.com' + url, {
    method,
    headers: body ? { ...H, 'Content-Type': 'application/json' } : H,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* not json */ }
  return { status: res.status, json, text }
}

// 1) clean YAML (drop comments, keep the entry)
const raw = await readFile(new URL('./wqx11235__dsh-experience.yml', import.meta.url), 'utf8')
const yaml = raw.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).join('\n') + '\n'
console.log('yaml:\n' + yaml)

// 2) upstream main sha
const up = await api('GET', `/repos/${UP}/git/ref/heads/main`)
if (up.status !== 200) { console.error('upstream read failed', up.status, up.text.slice(0, 200)); process.exit(1) }
const baseSha = up.json.object.sha
console.log('upstream main', baseSha)

// 3) fork
let fork = await api('GET', `/repos/${OWNER}/${REPO}`)
if (fork.status === 404) {
  const created = await api('POST', `/repos/${UP}/forks`, { default_branch_only: true })
  console.log('fork request', created.status)
  for (let i = 0; i < 40; i++) {
    await sleep(1500)
    fork = await api('GET', `/repos/${OWNER}/${REPO}`)
    if (fork.status === 200) break
  }
}
if (fork.status !== 200) { console.error('fork not ready', fork.status); process.exit(1) }
console.log('fork ready:', fork.json.full_name, 'default', fork.json.default_branch)

// 4) branch at upstream main
const ref = await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: baseSha })
if (ref.status !== 201 && ref.status !== 422) { console.error('branch failed', ref.status, ref.text.slice(0, 300)); process.exit(1) }
console.log('branch', BRANCH, ref.status === 422 ? '(exists)' : 'created')

// 5) file
const content = Buffer.from(yaml, 'utf8').toString('base64')
let file = await api('GET', `/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`)
const put = await api('PUT', `/repos/${OWNER}/${REPO}/contents/${PATH}`, {
  message: 'Add dsh-experience',
  content,
  branch: BRANCH,
  ...(file.status === 200 ? { sha: file.json.sha } : {}),
})
if (put.status !== 200 && put.status !== 201) { console.error('file failed', put.status, put.text.slice(0, 300)); process.exit(1) }
console.log('file committed', put.status)

// 6) PR
const bodyText = [
  'Adds **dsh-experience** — a self-learning experience library for DeepSeek Harness.',
  '',
  '- Local markdown knowledge with error-signature retrieval, failure capture, gap-to-entry closure, and a sidebar panel.',
  '- Bundle manifest + `cordis.patch.yml` are in the repo; CI is green.',
  '- No network access; ships a sanitized 12-entry starter library.',
  '',
  `Repo: https://github.com/${OWNER}/dsh-experience`,
].join('\n')
const pr = await api('POST', `/repos/${UP}/pulls`, {
  title: 'Add dsh-experience',
  head: `${OWNER}:${BRANCH}`,
  base: 'main',
  body: bodyText,
})
if (pr.status === 422) {
  const existing = await api('GET', `/repos/${UP}/pulls?head=${OWNER}:${BRANCH}&state=open`)
  console.log('PR may already exist:', JSON.stringify((existing.json || []).map((p) => p.html_url)))
} else if (pr.status !== 201) {
  console.error('PR failed', pr.status, pr.text.slice(0, 400)); process.exit(1)
} else {
  console.log('PR:', pr.json.html_url, 'number', pr.json.number)
}
