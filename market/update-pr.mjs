// Open a small PR updating the merged catalog entry's description.
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
const BRANCH = 'update-dsh-experience-desc'
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
  try { json = text ? JSON.parse(text) : null } catch { /* ignore */ }
  return { status: res.status, json, text }
}

const raw = await readFile(new URL('./wqx11235__dsh-experience.yml', import.meta.url), 'utf8')
const yaml = raw.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).join('\n') + '\n'

const up = await api('GET', `/repos/${UP}/git/ref/heads/main`)
if (up.status !== 200) { console.error('upstream read failed', up.status); process.exit(1) }
const baseSha = up.json.object.sha

// fork needs a moment after the first PR; wait until it is readable
for (let i = 0; i < 20; i++) {
  const f = await api('GET', `/repos/${OWNER}/${REPO}`)
  if (f.status === 200) break
  await sleep(1500)
}
const ref = await api('POST', `/repos/${OWNER}/${REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha: baseSha })
console.log('branch', ref.status === 422 ? 'exists' : 'created')

const cur = await api('GET', `/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`)
if (cur.status !== 200) { console.error('entry missing on branch', cur.status, cur.text.slice(0, 200)); process.exit(1) }
const put = await api('PUT', `/repos/${OWNER}/${REPO}/contents/${PATH}`, {
  message: 'Update dsh-experience description',
  content: Buffer.from(yaml, 'utf8').toString('base64'),
  branch: BRANCH,
  sha: cur.json.sha,
})
if (put.status !== 200 && put.status !== 201) { console.error('file update failed', put.status, put.text.slice(0, 300)); process.exit(1) }

const pr = await api('POST', `/repos/${UP}/pulls`, {
  title: 'Update dsh-experience description',
  head: `${OWNER}:${BRANCH}`,
  base: 'main',
  body: [
    'Refreshes the description to match the current feature set:',
    '',
    '- pre-step recall hints (before the agent acts, not only after a failure)',
    '- failure-to-fix drafts',
    '- explicit "no model calls, no network"',
    '',
    'No metadata or category change.',
  ].join('\n'),
})
if (pr.status === 201) console.log('PR:', pr.json.html_url)
else if (pr.status === 422) {
  const open = await api('GET', `/repos/${UP}/pulls?head=${OWNER}:${BRANCH}&state=open`)
  console.log('existing PR:', JSON.stringify((open.json || []).map((p) => p.html_url)))
} else {
  console.error('PR failed', pr.status, pr.text.slice(0, 300))
  process.exit(1)
}
