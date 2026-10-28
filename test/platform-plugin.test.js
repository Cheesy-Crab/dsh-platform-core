import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply, name } from '../src/index.js'

test('platform core is itself a loadable plugin with generic prompts', () => {
  const services = new Map()
  const cleanups = []
  const ctx = {
    logger: {},
    get: (key) => services.get(key),
    provide: (key, value) => services.set(key, value),
    effect: (factory) => {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-platform-plugin-'))
  try {
    assert.equal(name, 'dsh-platform-core')
    apply(ctx, { profileDir: profile })
    assert.ok(services.get('agentExtensions'))
    assert.deepEqual(services.get('agentExtensions').list().map((item) => item.name), [
      'platform:tool-failures',
      'platform:creative',
    ])
    assert.deepEqual(services.get('pluginRegistry').describe(), {
      plugins: 0,
      native: 0,
      legacy: 0,
      knowledge: 0,
      profile: 0,
      unknown: 0,
      profiles: 0,
      clients: 0,
    })
    assert.equal(services.get('platformHostDescriptor').id, 'dsh.platform-core')
    assert.equal(typeof services.get('fabricCompatibility'), 'function')
    assert.equal(services.get('fabricCompatibility')({ name: 'x', version: '1.0.0', dsh: { platform: {} } }).status, 'needs-adapter')
  } finally {
    for (const cleanup of cleanups) cleanup()
    fs.rmSync(profile, { recursive: true, force: true })
  }
})



