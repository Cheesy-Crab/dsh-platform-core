import assert from 'node:assert/strict'
import test from 'node:test'

import { effectiveProfileForAgent, isPrimaryAgent, platformPromptAllowed, profileCapabilitiesMode, profileForAgent } from '../src/agent-policy.js'

test('sub agents are not primary agents', () => {
  assert.equal(isPrimaryAgent({ id: 'main', session: { meta: {} } }, 'startup'), true)
  assert.equal(isPrimaryAgent({ parent: {} }, 'startup'), false)
  assert.equal(isPrimaryAgent({ session: { meta: { parentSessionId: 'p' } } }, 'startup'), false)
  assert.equal(isPrimaryAgent({}, 'subagent'), false)
  assert.equal(isPrimaryAgent({}, 'compaction'), false)
})

test('profile policy reads promptPolicy and capabilities mode', () => {
  const profiles = {
    list: () => [
      { id: 'tavern', agentPreset: 'tavern', promptPolicy: { platformPrompts: false, capabilities: 'none' } },
      { id: 'default', agentPreset: 'default' },
    ],
    get: (id) => [
      { id: 'tavern', agentPreset: 'tavern', promptPolicy: { platformPrompts: false, capabilities: 'none' } },
      { id: 'default', agentPreset: 'default' },
    ].find((profile) => profile.id === id),
  }
  const agent = { session: { meta: { agentPreset: 'tavern', profileId: 'tavern' } } }
  const profile = profileForAgent(agent, profiles)
  assert.equal(profile.id, 'tavern')
  assert.equal(platformPromptAllowed(profile), false)
  assert.equal(profileCapabilitiesMode(profile), 'none')
  assert.equal(profileCapabilitiesMode({}), 'index')
  assert.equal(platformPromptAllowed({}), true)
})

test('selected profile wins over prediction and prediction fills the gap', () => {
  const image = { id: 'image', agentPreset: 'standard' }
  const tavern = { id: 'tavern', agentPreset: 'tavern' }
  const profiles = {
    list: () => [image, tavern],
    get: (id) => [image, tavern].find((profile) => profile.id === id),
  }
  const predictor = { predict: () => image }
  const selected = effectiveProfileForAgent(
    { session: { meta: { profileId: 'tavern' } } },
    profiles,
    { predictor },
  )
  assert.deepEqual(selected, { profile: tavern, source: 'selected' })
  const predicted = effectiveProfileForAgent({ session: { meta: {} } }, profiles, { predictor })
  assert.deepEqual(predicted, { profile: image, source: 'predicted' })
})
