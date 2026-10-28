import assert from 'node:assert/strict'
import test from 'node:test'

import { repairProfileCapabilities } from '../src/capability-validation.js'

const managed = [
  { id: 'image.generate', bind: { tool: 'generate_image' } },
  { id: 'image.edit', bind: { tool: 'edit_image' } },
]

test('unknown capabilities are removed', () => {
  const seen = []
  const result = repairProfileCapabilities(
    { id: 'image', capabilities: ['image.generate', 'image.genrate'] },
    managed,
    { onUnknown: (id) => seen.push(id) },
  )
  assert.deepEqual(result.profile.capabilities, ['image.generate'])
  assert.deepEqual(seen, ['image.genrate'])
})

test('all-unknown capabilities fall back to no restriction', () => {
  const result = repairProfileCapabilities(
    { id: 'broken', capabilities: ['nope'] },
    managed,
  )
  assert.equal(result.profile.capabilities, undefined)
  assert.equal(result.profile.id, 'broken')
})
