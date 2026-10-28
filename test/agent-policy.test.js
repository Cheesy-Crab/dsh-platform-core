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

test('prediction is rejected when it would change the agent preset', () => {
  const image = { id: 'image', agentPreset: 'standard' }
  const tavern = { id: 'tavern', agentPreset: 'tavern' }
  const profiles = {
    list: () => [image, tavern],
    get: (id) => [image, tavern].find((profile) => profile.id === id),
  }
  const result = effectiveProfileForAgent(
    { session: { meta: { agentPreset: 'standard' } } },
    profiles,
    { predictor: { predict: () => tavern } },
  )
  assert.deepEqual(result, { profile: undefined, source: 'default' })
})

test('resume reuses the effective profile instead of predicting again', () => {
  const image = { id: 'image', agentPreset: 'standard' }
  const profiles = {
    list: () => [image],
    get: (id) => [image].find((profile) => profile.id === id),
  }
  let predicted = 0
  const result = effectiveProfileForAgent(
    { session: { meta: { agentPreset: 'standard', effectiveProfileId: 'image', effectiveProfileSource: 'predicted' } } },
    profiles,
    { predictor: { predict: () => { predicted += 1; return image } } },
  )
  assert.deepEqual(result, { profile: image, source: 'predicted' })
  assert.equal(predicted, 0)
})

test('a throwing predictor falls back instead of breaking agent creation', () => {
  const profiles = { list: () => [], get: () => undefined }
  const result = effectiveProfileForAgent(
    { session: { meta: { agentPreset: 'standard' } } },
    profiles,
    { predictor: { predict: () => { throw new Error('stats unavailable') } } },
  )
  assert.equal(result.profile, undefined)
  assert.equal(result.source, 'default')
  assert.equal(result.predictionError.message, 'stats unavailable')
})
