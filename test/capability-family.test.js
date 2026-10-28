import assert from 'node:assert/strict'
import test from 'node:test'

import { expandCapabilityFamilies } from '../src/capability-family.js'

const capabilities = [
  { id: 'image.generate', family: 'image' },
  { id: 'image.edit', family: 'image' },
  { id: 'web.search', family: 'web' },
]

test('predicted profiles expand to their whole family', () => {
  const profile = { id: 'image', capabilities: ['image.generate'], families: ['image'] }
  const expanded = expandCapabilityFamilies(profile, capabilities)
  assert.deepEqual(expanded.capabilities.sort(), ['image.edit', 'image.generate'])
})

test('profiles without a family stay narrow', () => {
  const profile = { id: 'image', capabilities: ['image.generate'] }
  assert.deepEqual(expandCapabilityFamilies(profile, capabilities), profile)
})
