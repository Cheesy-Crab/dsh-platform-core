import assert from 'node:assert/strict'
import test from 'node:test'

import { applyToolExposure, capabilityToolMap } from '../src/tool-exposure.js'

const capabilities = [
  { id: 'image.generate', bind: { tool: 'generate_image' } },
  { id: 'image.edit', bind: { tool: 'edit_image' } },
  { id: 'image.inspiration', bind: { tool: 'find_inspiration' } },
]

function agent(names) {
  const calls = []
  return {
    calls,
    ctx: {
      tools: {
        schemas: () => names.map((name) => ({ name })),
        restrict: (filter) => {
          calls.push(filter)
          return () => {}
        },
      },
    },
  }
}

test('capability tool map only includes bound tools', () => {
  const map = capabilityToolMap(capabilities)
  assert.equal(map.get('image.generate'), 'generate_image')
  assert.equal(map.get('image.edit'), 'edit_image')
  assert.equal(map.has('image.missing'), false)
})

test('active capabilities keep their tools and deny only inactive managed tools', () => {
  const a = agent(['read', 'generate_image', 'edit_image', 'find_inspiration'])
  const dispose = applyToolExposure(a, {
    capabilities,
    profile: { capabilities: ['image.generate'] },
  })
  assert.equal(typeof dispose, 'function')
  assert.deepEqual(a.calls[0].deny.sort(), ['edit_image', 'find_inspiration'])
})

test('legacy profile without capabilities does not restrict tools', () => {
  const a = agent(['read', 'generate_image'])
  assert.equal(applyToolExposure(a, { capabilities, profile: {} }), undefined)
  assert.equal(a.calls.length, 0)
})

test('unknown/unregistered tools are not sent to restrict', () => {
  const a = agent(['read', 'generate_image'])
  applyToolExposure(a, {
    capabilities,
    profile: { capabilities: [] },
  })
  assert.deepEqual(a.calls[0].deny, ['generate_image'])
})
