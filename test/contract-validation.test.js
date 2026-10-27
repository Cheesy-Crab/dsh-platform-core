import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { readPlatformManifest, validatePlatformManifest } from '../src/manifest.js'
import { classifyPlugin } from '../src/plugin-adapter.js'
import { discoverPlugins } from '../src/registry.js'

function pkg(platform) {
  return { name: 'contract-demo', version: '1.0.0', dsh: { platform } }
}

test('contract major 1 is accepted', () => {
  for (const contract of ['1.0', '1.1', '1.2', '1.9.3', '1.2.0-rc.1', 1, 1.2]) {
    const result = validatePlatformManifest(pkg({ contract }))
    assert.equal(result.ok, true, `contract ${String(contract)} should be accepted`)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.warnings, [])
    assert.equal(result.major, 1)
    assert.equal(typeof result.contract, 'string')
  }
})

test('missing contract is accepted as legacy 1.0 with a warning', () => {
  const result = validatePlatformManifest({ name: 'demo', dsh: {} })
  assert.equal(result.ok, true)
  assert.equal(result.contract, '1.0')
  assert.equal(result.legacy, true)
  assert.equal(result.major, 1)
  assert.deepEqual(result.errors, [])
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /contract/i)
  assert.match(result.warnings[0], /1\.0/)
  assert.equal(result.manifest.contract, '1.0')

  // The pre-1.2 `dsh.pluginApi` field is still understood.
  const legacy = validatePlatformManifest({ dsh: { pluginApi: '1.1' } })
  assert.equal(legacy.ok, true)
  assert.equal(legacy.contract, '1.1')
  assert.deepEqual(legacy.warnings, [])
})

test('contract major >= 2 is rejected', () => {
  for (const contract of ['2.0', '2.1.0', 2, '10.0']) {
    const result = validatePlatformManifest(pkg({ contract }))
    assert.equal(result.ok, false, `contract ${String(contract)} should be rejected`)
    assert.ok(result.errors.some((error) => /major/.test(error)), `expected a major error for ${String(contract)}`)
    assert.deepEqual(result.warnings, [])
  }
})

test('malformed contract is rejected', () => {
  for (const contract of ['banana', 'latest', '', '1.x', 'v1.2', '1.2.3.4', {}, [], true]) {
    const result = validatePlatformManifest(pkg({ contract }))
    assert.equal(result.ok, false, `contract ${JSON.stringify(contract)} should be rejected`)
    assert.ok(result.errors.length > 0)
  }
})

test('valid profiles and capabilities pass validation', () => {
  const result = validatePlatformManifest(pkg({
    contract: '1.2',
    capabilities: [{ id: 'image.generate' }, { id: 'chat.reply' }],
    profiles: [
      { id: 'tavern', agentPreset: 'tavern' },
      { id: 'coder', agentPreset: 'coder' },
    ],
  }))
  assert.equal(result.ok, true)
  assert.deepEqual(result.errors, [])
  assert.equal(result.manifest.profiles.length, 2)
  assert.equal(result.manifest.capabilities.length, 2)
})

test('profiles require non-empty id and agentPreset', () => {
  const missingPreset = validatePlatformManifest(pkg({
    contract: '1.2',
    profiles: [{ id: 'tavern' }],
  }))
  assert.equal(missingPreset.ok, false)
  assert.ok(missingPreset.errors.some((error) => /agentPreset/.test(error)))

  const missingId = validatePlatformManifest(pkg({
    contract: '1.2',
    profiles: [{ id: '   ', agentPreset: 'tavern' }],
  }))
  assert.equal(missingId.ok, false)
  assert.ok(missingId.errors.some((error) => /\.id/.test(error)))

  const nonObject = validatePlatformManifest(pkg({ contract: '1.2', profiles: ['tavern'] }))
  assert.equal(nonObject.ok, false)
})

test('duplicate profile ids are rejected', () => {
  const result = validatePlatformManifest(pkg({
    contract: '1.2',
    profiles: [
      { id: 'tavern', agentPreset: 'tavern' },
      { id: 'tavern', agentPreset: 'other' },
    ],
  }))
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => /duplicate/i.test(error) && /tavern/.test(error)))
})

test('capabilities require non-empty ids and reject duplicates', () => {
  const missing = validatePlatformManifest(pkg({ contract: '1.2', capabilities: [{ kind: 'action' }] }))
  assert.equal(missing.ok, false)
  assert.ok(missing.errors.some((error) => /\.id/.test(error)))

  const empty = validatePlatformManifest(pkg({ contract: '1.2', capabilities: [{ id: '' }] }))
  assert.equal(empty.ok, false)

  const duplicate = validatePlatformManifest(pkg({
    contract: '1.2',
    capabilities: [{ id: 'image.generate' }, { id: 'image.generate' }],
  }))
  assert.equal(duplicate.ok, false)
  assert.ok(duplicate.errors.some((error) => /duplicate/i.test(error) && /image\.generate/.test(error)))
})

test('legacy dsh.capabilities are validated too', () => {
  const duplicate = validatePlatformManifest({
    name: 'legacy-demo',
    dsh: {
      pluginApi: '1.1',
      capabilities: [{ id: 'chat.reply' }, { id: 'chat.reply' }],
    },
  })
  assert.equal(duplicate.ok, false)
  assert.ok(duplicate.errors.some((error) => /dsh\.capabilities\[1\]/.test(error)))
})

test('rejected manifests classify as unknown with warnings, never native', () => {
  const classification = classifyPlugin({
    name: 'bad-contract',
    dsh: {
      platform: {
        contract: '2.0',
        capabilities: [{ id: 'image.generate', kind: 'action', bind: { tool: 'generate_image' } }],
      },
    },
  })
  assert.equal(classification.level, 'unknown')
  assert.deepEqual(classification.capabilities, [])
  assert.deepEqual(classification.profiles, [])
  assert.deepEqual(classification.prompts, [])
  assert.equal(classification.requiresReview, true)
  assert.equal(classification.validation.ok, false)
  assert.ok(classification.warnings.some((warning) => /contract/i.test(warning)))

  const duplicate = classifyPlugin({
    name: 'duplicate-capabilities',
    dsh: {
      platform: {
        contract: '1.2',
        capabilities: [{ id: 'image.generate' }, { id: 'image.generate' }],
      },
    },
  })
  assert.equal(duplicate.level, 'unknown')
  assert.ok(duplicate.warnings.length > 0)
})

test('accepted manifests keep their previous classification', () => {
  const native = classifyPlugin({
    dsh: { pluginApi: '1.1', capabilities: [{ id: 'image.generate' }] },
  })
  assert.equal(native.level, 'native')
  assert.equal(native.validation.ok, true)
  assert.deepEqual(native.warnings, [])

  const profile = classifyPlugin({
    name: 'tavern-like',
    dsh: {
      platform: {
        contract: '1.2',
        capabilities: [],
        profiles: [{ id: 'tavern', agentPreset: 'tavern' }],
      },
    },
  })
  assert.equal(profile.level, 'profile')
})

test('discovery surfaces contract validation on each plugin', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-contract-'))
  const modules = path.join(root, 'node_modules')
  fs.mkdirSync(modules, { recursive: true })
  const write = (name, pkgJson) => {
    const dir = path.join(modules, ...name.split('/'))
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkgJson, null, 2)}\n`, 'utf8')
  }
  write('plugin-good', {
    name: 'plugin-good',
    version: '1.0.0',
    dsh: { platform: { contract: '1.2', capabilities: [{ id: 'image.generate' }] } },
  })
  write('plugin-bad', {
    name: 'plugin-bad',
    version: '1.0.0',
    dsh: { platform: { contract: '2.0', capabilities: [{ id: 'image.generate' }] } },
  })
  write('plugin-legacy', {
    name: 'plugin-legacy',
    version: '1.0.0',
    dsh: { prompts: ['./prompts/domain.md'] },
  })

  try {
    const plugins = discoverPlugins({ profileDir: root })
    const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]))

    assert.equal(byName.get('plugin-good').level, 'native')
    assert.equal(byName.get('plugin-good').validation.ok, true)

    const bad = byName.get('plugin-bad')
    assert.equal(bad.level, 'unknown')
    assert.equal(bad.validation.ok, false)
    assert.deepEqual(bad.capabilities, [])
    assert.ok(bad.warnings.some((warning) => /contract/i.test(warning)))
    assert.equal(bad.requiresReview, true)

    const legacy = byName.get('plugin-legacy')
    assert.equal(legacy.level, 'knowledge-only')
    assert.equal(legacy.validation.legacy, true)
    assert.ok(legacy.validation.warnings.some((warning) => /legacy contract 1\.0/.test(warning)))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('readPlatformManifest still returns the declared contract untouched', () => {
  assert.equal(readPlatformManifest(pkg({ contract: '1.2' })).contract, '1.2')
  assert.equal(readPlatformManifest({ dsh: {} }).contract, '1.0')
})
