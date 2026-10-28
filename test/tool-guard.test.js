import assert from 'node:assert/strict'
import test from 'node:test'

import { applyToolGuard } from '../src/tool-guard.js'

const capabilities = [
  { id: 'image.generate', bind: { tool: 'generate_image' } },
  { id: 'image.edit', bind: { tool: 'edit_image' } },
]

function agent() {
  const guards = []
  return {
    guards,
    ctx: { tools: { guard: (guard) => guards.push(guard) } },
  }
}

test('scope tool guard denies inactive capability tools', () => {
  const a = agent()
  applyToolGuard(a, {
    capabilities,
    profile: { id: 'image', capabilities: ['image.generate'] },
  })
  assert.equal(a.guards.length, 1)
  assert.equal(a.guards[0]({ toolName: 'edit_image' }).includes('does not allow'), true)
  assert.equal(a.guards[0]({ toolName: 'generate_image' }), undefined)
  assert.equal(a.guards[0]({ toolName: 'read' }), undefined)
})

test('no guard when all managed tools are active', () => {
  const a = agent()
  applyToolGuard(a, {
    capabilities,
    profile: { id: 'image', capabilities: ['image.generate', 'image.edit'] },
  })
  assert.equal(a.guards.length, 0)
})
