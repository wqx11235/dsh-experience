// Run every gate the project ships: host-free integration tests, library link
// check, and the privacy scan over the public starter library.
import { spawn } from 'node:child_process'

const steps = [
  ['host-harness', ['test/host-harness.mjs']],
  ['linkcheck', ['test/linkcheck.mjs', 'library']],
  ['privacy', ['tools/privacy-rules.mjs', 'library']],
]

let failed = 0
for (const [name, args] of steps) {
  console.log(`\n=== ${name}`)
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    child.on('exit', (c) => resolve(c ?? 1))
  })
  if (code !== 0) failed += 1
}
console.log(failed ? `\n${failed} gate(s) failed` : '\nall gates passed')
process.exit(failed ? 1 : 0)
