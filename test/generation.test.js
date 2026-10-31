import assert from 'node:assert/strict'
import test from 'node:test'

import { GenerationRegistry, capabilitySignature } from '../src/generation.js'

test('a new session gets a generation and a resume reuses it', () => {
  const generations = new GenerationRegistry()
  const first = generations.forSession('s1', { profileId: 'image', capabilitySignature: 'image.generate' })
  assert.match(first.id, /^gen-/)
  assert.equal(first.reason, 'session-created')
  const resumed = generations.forSession('s1', { profileId: 'image', capabilitySignature: 'image.generate' })
  assert.equal(resumed.id, first.id)
})

test('a different profile id forks the generation', () => {
  const generations = new GenerationRegistry()
  const first = generations.forSession('s1', { profileId: 'image' })
  const second = generations.forSession('s1', { profileId: 'tavern' })
  assert.notEqual(second.id, first.id)
  assert.equal(second.reason, 'profile-switch')
  assert.equal(generations.isCurrent('s1', first.id), false)
  assert.equal(generations.isCurrent('s1', second.id), true)
})

test('a different capability set forks the generation', () => {
  const generations = new GenerationRegistry()
  const first = generations.forSession('s1', { profileId: 'image', capabilitySignature: 'image.generate' })
  const second = generations.forSession('s1', { profileId: 'image', capabilitySignature: 'image.edit' })
  assert.notEqual(second.id, first.id)
  assert.equal(second.reason, 'capability-switch')
  assert.deepEqual(generations.staleReason('s1', first.id), { requested: first.id, current: second.id })
})

test('unknown sessions or missing ids are not treated as stale', () => {
  const generations = new GenerationRegistry()
  assert.equal(generations.isCurrent('nobody', 'gen-x'), true)
  assert.equal(generations.isCurrent('s1', undefined), true)
  assert.equal(generations.forSession(undefined), undefined)
  assert.equal(generations.forSession(''), undefined)
})

test('capability signature is order independent', () => {
  assert.equal(capabilitySignature({ capabilities: ['b', 'a'] }), 'a,b')
  assert.equal(capabilitySignature({ capabilities: ['a', 'b'] }), 'a,b')
  assert.equal(capabilitySignature({ capabilities: [] }), 'none')
  assert.equal(capabilitySignature(undefined), undefined)
})

test('stats count sessions and forks by reason', () => {
  const generations = new GenerationRegistry()
  generations.forSession('s1', { profileId: 'image' })
  generations.forSession('s1', { profileId: 'tavern' })
  generations.forSession('s2', { profileId: 'image' })
  assert.deepEqual(generations.stats(), {
    sessions: 2,
    forked: 3,
    byReason: { 'session-created': 2, 'profile-switch': 1 },
  })
})
