// Pull READMEs for the closest experience/memory plugins in the catalog.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const H = { 'User-Agent': 'dsh-agent', Accept: 'application/vnd.github+json' }
const OUT = fileURLToPath(new URL('./readmes/', import.meta.url))
await mkdir(OUT, { recursive: true })

const cat = await (await fetch('https://awesome-dsh-plugin.com/plugins.json', { headers: H })).json()
const arr = cat.plugins || cat
const want = [
  'memsearch#MemSearch',
  'ReMe#dsh',
  'MemOS#memos-local-plugin',
  'OpenViking#examples/dsh-memory-plugin',
  'graph-memory',
  'dsh-memory-evolve',
  'MisakaNet',
  'deja-vu#extensions/dsh',
  'hindsight#coding-agents',
  'dsh-mnemon',
]
for (const name of want) {
  const e = arr.find((x) => x.name === name)
  if (!e) { console.log('missing', name); continue }
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+\/(.+))?$/.exec(e.url)
  if (!m) { console.log('bad url', name, e.url); continue }
  const [, owner, repo, sub] = m
  const path = sub ? `${sub}/README.md` : 'README.md'
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
  const res = await fetch(api, { headers: { ...H, Accept: 'application/vnd.github.raw' } })
  const text = res.ok ? await res.text() : `FETCH ${res.status} ${api}`
  const file = name.replace(/[^A-Za-z0-9._-]+/g, '_') + '.md'
  await writeFile(join(OUT, file), text.slice(0, 20000))
  console.log('saved', name, '->', file, text.length, 'chars', res.status)
}
