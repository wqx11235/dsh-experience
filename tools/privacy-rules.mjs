// Privacy rules for the public library. Shared by the build gate and CI.
//
//   node tools/privacy-rules.mjs [dir]     # defaults to ./library
//
// Any hit is a hard failure: the starter library is meant to be publishable as
// is, so "probably harmless" is not good enough.
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadLocalTerms, compileDenylist } from './local-terms.mjs'

// Machine-independent rules. Anything that names the author's machine, accounts
// or private projects goes into tools/private-terms.local.json (gitignored) and
// is appended from there, so the public repo carries no private words.
export const RULES = [
  ['abs-path', /(?<![A-Za-z0-9])[A-Za-z]:[\\/][^\s`"'<>|）)，。；;]+/g],
  ['home-user', /[A-Za-z]:[\\/]Users[\\/][A-Za-z0-9_.-]+/gi],
  ['unix-home', /\/home\/[A-Za-z0-9_.-]+/g],
  ['email', /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g],
  ['secret', /(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/g],
  ['account-id', /(?:QQ|qq|群号|账号|用户ID|uid)\s*[:：=]?\s*\d{6,12}/g],
]

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}

export async function checkFiles(dir) {
  const root = resolve(dir)
  const findings = []
  const localRules = compileDenylist((await loadLocalTerms()).denylist)
  const rules = [...RULES, ...localRules]
  for (const file of await walk(root)) {
    const rel = relative(root, file).split(sep).join('/')
    const lines = (await readFile(file, 'utf8')).split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      for (const [rule, re] of rules) {
        re.lastIndex = 0
        const m = re.exec(lines[i])
        if (!m) continue
        // `C:\Users\<user>` is a placeholder, not a machine path: the regex stops
        // right before the angle bracket.
        if (rule === 'abs-path' && lines[i][m.index + m[0].length] === '<') continue
        findings.push({ file: rel, line: i + 1, rule, excerpt: m[0].slice(0, 80) })
      }
    }
  }
  return findings
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  const dir = resolve(process.argv[2] || 'library')
  const findings = await checkFiles(dir)
  console.log(`privacy scan: ${dir}`)
  for (const f of findings) console.log(`  ${f.file}:${f.line}  ${f.rule}  ${f.excerpt}`)
  console.log(findings.length ? `FAIL (${findings.length} findings)` : 'OK (0 findings)')
  process.exit(findings.length ? 1 : 0)
}
