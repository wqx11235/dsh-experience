// Optional, NOT committed: words and paths that only exist on the author's
// machine. `tools/build-library.mjs` and `tools/privacy-rules.mjs` load it when
// present, so the public repo stays free of private terms while the local build
// still redacts and gates them.
//
// Shape (see tools/local-terms.example.json):
// {
//   "redactions": [
//     { "label": "workspace", "pattern": "[A-Za-z]:[\\\\/]my-workspace", "flags": "gi", "replace": "<workspace>" },
//     { "label": "local-word", "find": "本机", "replace": "该环境" }
//   ],
//   "denylist": [
//     { "rule": "workspace-name", "pattern": "my-workspace", "flags": "i" }
//   ]
// }
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const LOCAL_TERMS_FILE = join(HERE, 'private-terms.local.json')

export async function loadLocalTerms() {
  let raw
  try { raw = await readFile(LOCAL_TERMS_FILE, 'utf8') } catch { return { redactions: [], denylist: [] } }
  try {
    const data = JSON.parse(raw)
    return {
      redactions: Array.isArray(data.redactions) ? data.redactions : [],
      denylist: Array.isArray(data.denylist) ? data.denylist : [],
    }
  } catch (err) {
    // Silent failure here means "no redaction", i.e. a possible leak. Refuse.
    console.error(`[local-terms] ${LOCAL_TERMS_FILE} is not valid JSON: ${err.message}`)
    console.error('[local-terms] fix the file or remove it; refusing to build without it.')
    process.exit(1)
  }
}

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g
const escapeRegExp = (s) => String(s).replace(ESCAPE_RE, '\\$&')

export function compileRedactions(list) {
  const out = []
  for (const r of list || []) {
    if (r.find !== undefined) {
      // Literal find/replace: global, because a single .replace(string) only
      // hits the first occurrence and leaves later ones unredacted.
      out.push([r.label || 'local', new RegExp(escapeRegExp(r.find), 'g'), r.replace || ''])
      continue
    }
    if (r.pattern !== undefined) {
      try { out.push([r.label || 'local', new RegExp(r.pattern, r.flags || 'g'), r.replace || '']) } catch { /* skip bad rule */ }
    }
  }
  return out
}

export function compileDenylist(list) {
  const out = []
  for (const r of list || []) {
    if (!r.pattern) continue
    try { out.push([r.rule || 'local-term', new RegExp(r.pattern, r.flags || 'gi')]) } catch { /* skip */ }
  }
  return out
}
