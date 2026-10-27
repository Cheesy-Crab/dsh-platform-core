import assert from 'node:assert/strict'
import test from 'node:test'

import { adaptToolResult, classifyPlugin, createPluginAdapter } from '../src/plugin-adapter.js'

test('native capability manifests are trusted as-is', () => {
  const classification = classifyPlugin({
    dsh: {
      pluginApi: '1.1',
      capabilities: [{ id: 'image.generate', kind: 'action', bind: { tool: 'generate_image' } }],
    },
  })
  assert.equal(classification.level, 'native')
  assert.equal(classification.capabilities[0].id, 'image.generate')
  assert.equal(classification.capabilities[0].inferred, false)
  assert.equal(classification.requiresReview, false)
})

test('legacy image tools are classified conservatively', () => {
  const classification = classifyPlugin({
    dsh: {
      tools: [{ name: 'generate_image', outputs: ['image'] }],
      prompts: ['./prompts/image.md'],
    },
  })
  assert.equal(classification.level, 'legacy-tools')
  const capability = classification.capabilities[0]
  assert.equal(capability.kind, 'action')
  assert.equal(capability.id, 'action.generate-image')
  assert.deepEqual(capability.bind, { tool: 'generate_image' })
  assert.ok(capability.effects.includes('network'))
  assert.ok(capability.effects.includes('cost'))
  assert.ok(capability.permissions.includes('image'))
  assert.equal(capability.requiresReview, true)
})

test('prompt-only plugins become knowledge capabilities', () => {
  const classification = classifyPlugin({
    dsh: { prompts: ['./prompts/domain.md'], skills: ['./skills/domain/SKILL.md'] },
  })
  assert.equal(classification.level, 'knowledge-only')
  assert.equal(classification.capabilities[0].kind, 'knowledge')
  assert.equal(classification.capabilities[0].inferred, true)
})

test('unknown plugins are observe-only and need review', () => {
  const classification = classifyPlugin({ dsh: {} })
  assert.equal(classification.level, 'unknown')
  assert.equal(classification.capabilities.length, 0)
  assert.equal(classification.requiresReview, true)
})

test('legacy savedTo/cost results normalize to the platform contract', () => {
  const result = adaptToolResult({
    savedTo: 'E:\\ws\\dsh-image-gen\\image-1.jpg',
    cost: { total: 14, base: 4 },
  })
  assert.equal(result.source, 'legacy')
  assert.equal(result.outputs.length, 1)
  assert.equal(result.outputs[0].kind, 'image')
  assert.match(result.outputs[0].path, /image-1\.jpg$/)
  assert.deepEqual(result.cost, { amount: 14, unit: 'buzz' })
})

test('native meta.dsh results win over legacy fields', () => {
  const result = adaptToolResult({
    savedTo: 'legacy.jpg',
    dsh: {
      version: '1.0',
      outputs: [{ kind: 'image', path: 'native.jpg', mime: 'image/jpeg' }],
      retry: { retryable: true, maxAttempts: 1 },
    },
  })
  assert.equal(result.source, 'native')
  assert.equal(result.outputs[0].path, 'native.jpg')
  assert.equal(result.retry.maxAttempts, 1)
})

test('runtime adapter maps tool names to inferred capabilities', () => {
  const adapter = createPluginAdapter({ dsh: { tools: [{ name: 'send_message' }] } })
  assert.equal(adapter.capabilityForTool('send_message').kind, 'communication')
  assert.equal(adapter.capabilityForTool('missing'), undefined)
  assert.equal(adapter.normalizeResult({ savedTo: '/ws/a.png' }).outputs.length, 1)
})
