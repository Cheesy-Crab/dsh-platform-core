import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createHostDescriptor,
  fabricCompatibility,
  negotiateCapabilities,
  satisfiesVersion,
  toFabricManifest,
} from '../src/fabric.js'

const host = createHostDescriptor({
  capabilities: { 'x-dsh.extra': '1.0.0' },
})

test('host descriptor advertises platform capabilities without claiming Fabric conformance', () => {
  assert.equal(host.descriptorVersion, '0.1.0')
  assert.equal(host.id, 'dsh.platform-core')
  assert.equal(host.execution.trustMode, 'trusted-in-process')
  assert.equal(host.capabilities['dsh.platform.manifest'], '1.2.0')
  assert.equal(host.capabilities['dsh.platform.profiles'], '1.2.0')
  assert.equal(host.capabilities['x-dsh.extra'], '1.0.0')
  assert.deepEqual(host.surfaces, ['qq', 'web'])
})

test('required/optional capability negotiation distinguishes degraded and incompatible', () => {
  assert.equal(satisfiesVersion('1.2.3', '>=1.0.0 <2.0.0'), true)
  assert.equal(satisfiesVersion('2.0.0', '>=1.0.0 <2.0.0'), false)
  assert.equal(satisfiesVersion('1.2.3', '^1.2.0'), true)

  const compatible = negotiateCapabilities({
    required: { 'dsh.platform.manifest': '>=1.0.0 <2.0.0' },
    optional: { 'dsh.platform.delivery': '^1.0.0' },
  }, host)
  assert.equal(compatible.status, 'compatible')

  const degraded = negotiateCapabilities({
    required: { 'dsh.platform.manifest': '^1.0.0' },
    optional: { 'x-missing': '^1.0.0' },
  }, host)
  assert.equal(degraded.status, 'degraded')
  assert.equal(degraded.missingOptional[0].reason, 'missing')

  const incompatible = negotiateCapabilities({
    required: { 'x-missing': '^1.0.0' },
  }, host)
  assert.equal(incompatible.status, 'incompatible')
  assert.equal(incompatible.missingRequired[0].reason, 'missing')
})

test('dsh.platform projects to a Fabric-shaped manifest without silently adopting it', () => {
  const pkg = {
    name: '@demo/tool',
    version: '1.0.0',
    main: './src/index.js',
    dsh: {
      platform: {
        contract: '1.2',
        requires: { required: { 'dsh.platform.manifest': '^1.0.0' } },
        capabilities: [{ id: 'demo.tool', bind: { tool: 'demo_tool' } }],
        profiles: [{ id: 'demo', agentPreset: 'demo' }],
      },
    },
  }
  const projected = toFabricManifest(pkg, { host })
  assert.equal(projected.id, '@demo/tool')
  assert.equal(projected.xDsh.status, 'needs-adapter')
  assert.deepEqual(projected.xDsh.domainCapabilities, ['demo.tool'])
  assert.equal(projected.xDsh.negotiation.status, 'compatible')
  assert.deepEqual(projected.xDsh.profiles, ['demo'])

  const report = fabricCompatibility(pkg, { host })
  assert.equal(report.status, 'needs-adapter')
  assert.ok(report.reasons.some((reason) => reason.includes('Draft')))
})
