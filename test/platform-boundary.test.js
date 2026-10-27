import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const platformDir = path.join(root, 'src')

function files(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...files(file))
    else if (entry.name.endsWith('.js')) out.push(file)
  }
  return out
}

function importsOf(file) {
  const source = fs.readFileSync(file, 'utf8')
  return [...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].map((match) => match[1])
}

test('platform core never imports the QQ adapter or transport', () => {
  const offenders = []
  for (const file of files(platformDir)) {
    for (const specifier of importsOf(file)) {
      if (specifier.startsWith('node:')) continue
      if (specifier.startsWith('./')) continue
      offenders.push(`${path.relative(root, file)} -> ${specifier}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('platform core exposes a surface-neutral public API', async () => {
  const api = await import('../src/index.js')
  assert.equal(typeof api.classifyPlugin, 'function')
  assert.equal(typeof api.createPluginAdapter, 'function')
  assert.equal(typeof api.adaptToolResult, 'function')
  assert.equal(typeof api.forwardMediaOutputs, 'function')
  assert.equal(typeof api.installCreativePrompt, 'function')
  assert.equal(typeof api.installToolFailurePrompt, 'function')
})
