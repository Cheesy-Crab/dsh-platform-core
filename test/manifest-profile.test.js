import assert from 'node:assert/strict'
import test from 'node:test'

import { readPlatformManifest } from '../src/manifest.js'
import { ProfileRegistry } from '../src/profiles.js'
import { classifyPlugin } from '../src/plugin-adapter.js'

test('platform namespace is read with legacy fallback', () => {
  const next = readPlatformManifest({
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      platform: { contract: '1.2', capabilities: [{ id: 'x' }], profiles: [{ id: 'tavern' }] },
    },
  })
  assert.equal(next.contract, '1.2')
  assert.equal(next.capabilities.length, 1)
  assert.equal(next.profiles.length, 1)
  assert.ok(next.roles.includes('capability'))
  assert.ok(next.roles.includes('profile'))
  assert.ok(next.roles.includes('bundle'))

  const legacy = readPlatformManifest({ dsh: { pluginApi: '1.1', capabilities: [{ id: 'y' }] } })
  assert.equal(legacy.contract, '1.1')
  assert.equal(legacy.capabilities[0].id, 'y')
})

test('profile plugins are classified without becoming capabilities', () => {
  const result = classifyPlugin({
    name: 'tavern-like',
    dsh: {
      platform: {
        contract: '1.2',
        capabilities: [],
        profiles: [{ id: 'tavern', agentPreset: 'tavern' }],
      },
    },
  })
  assert.equal(result.level, 'profile')
  assert.equal(result.capabilities.length, 0)
  assert.equal(result.profiles[0].id, 'tavern')
})

test('profile registry resolves by id and surface', () => {
  const registry = new ProfileRegistry([
    { id: 'tavern', agentPreset: 'tavern', surfaces: ['web', 'qq'] },
    { id: 'other', agentPreset: 'other', surfaces: ['web'] },
  ])
  assert.equal(registry.get('tavern').agentPreset, 'tavern')
  assert.deepEqual(registry.bySurface('qq').map((p) => p.id), ['tavern'])
  assert.equal(registry.resolve('tavern').agentPreset, 'tavern')
  assert.equal(registry.resolve('missing'), undefined)
})
