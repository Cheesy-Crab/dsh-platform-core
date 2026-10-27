import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { discoverPlugins, PluginRegistry } from '../src/index.js'

function tempProfile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-platform-registry-'))
  const modules = path.join(root, 'node_modules')
  fs.mkdirSync(modules, { recursive: true })
  const write = (name, pkg) => {
    const dir = path.join(modules, ...name.split('/'))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  }
  write('plugin-native', {
    name: 'plugin-native',
    version: '1.0.0',
    dsh: {
      pluginApi: '1.1',
      capabilities: [{ id: 'image.generate', kind: 'action', bind: { tool: 'generate_image' } }],
    },
  })
  write('plugin-legacy', {
    name: 'plugin-legacy',
    version: '1.0.0',
    dsh: { tools: [{ name: 'draw_picture', outputs: ['image'] }] },
  })
  write('@scope/plugin-knowledge', {
    name: '@scope/plugin-knowledge',
    version: '1.0.0',
    dsh: { prompts: ['./prompts/domain.md'] },
  })
  write('not-a-plugin', { name: 'not-a-plugin', version: '1.0.0' })
  return root
}

test('discovery finds and classifies installed plugins without running them', () => {
  const root = tempProfile()
  try {
    const plugins = discoverPlugins({ profileDir: root })
    assert.deepEqual(plugins.map((plugin) => plugin.name), ['@scope/plugin-knowledge', 'plugin-legacy', 'plugin-native'])
    assert.equal(plugins.find((plugin) => plugin.name === 'plugin-native').level, 'native')
    assert.equal(plugins.find((plugin) => plugin.name === 'plugin-legacy').level, 'legacy-tools')
    assert.equal(plugins.find((plugin) => plugin.name === '@scope/plugin-knowledge').level, 'knowledge-only')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('registry resolves tools, capabilities, prompts and stats', () => {
  const root = tempProfile()
  try {
    const registry = new PluginRegistry(discoverPlugins({ profileDir: root }))
    assert.equal(registry.list().length, 3)
    assert.equal(registry.forTool('generate_image').id, 'image.generate')
    assert.equal(registry.forTool('draw_picture').id, 'action.draw-picture')
    assert.equal(registry.forTool('missing'), undefined)
    assert.equal(registry.prompts().length, 1)
    assert.deepEqual(registry.describe(), { plugins: 3, native: 1, legacy: 1, knowledge: 1, unknown: 0 })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
