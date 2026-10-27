import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { discoverPlugins } from '../src/registry.js'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-inventory-'))
  const pkg = path.join(root, 'node_modules', '@demo', 'tool')
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({
    name: '@demo/tool',
    version: '1.0.0',
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      platform: {
        contract: '1.2',
        capabilities: [{ id: 'demo.tool', kind: 'action', bind: { tool: 'demo_tool' } }],
      },
    },
  }))
  return root
}

test('inventory mode skips directory scanning and disabled entries', () => {
  const root = fixture()
  try {
    const enabled = discoverPlugins({
      profileDir: root,
      inventory: { entries: [{ moduleName: '@demo/tool', enabled: true, fiberPhase: 'active' }] },
    })
    assert.deepEqual(enabled.map((item) => item.name), ['@demo/tool'])

    const disabled = discoverPlugins({
      profileDir: root,
      inventory: { entries: [{ moduleName: '@demo/tool', enabled: false }] },
    })
    assert.deepEqual(disabled, [])

    const failed = discoverPlugins({
      profileDir: root,
      inventory: { entries: [{ moduleName: '@demo/tool', enabled: true, fiberPhase: 'failed' }] },
    })
    assert.deepEqual(failed, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
