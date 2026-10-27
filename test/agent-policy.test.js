import assert from 'node:assert/strict'
import test from 'node:test'

import { isPrimaryAgent, platformPromptAllowed, profileCapabilitiesMode, profileForAgent } from '../src/agent-policy.js'

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
  }
  const agent = { session: { meta: { agentPreset: 'tavern' } } }
  const profile = profileForAgent(agent, profiles)
  assert.equal(profile.id, 'tavern')
  assert.equal(platformPromptAllowed(profile), false)
  assert.equal(profileCapabilitiesMode(profile), 'none')
  assert.equal(profileCapabilitiesMode({}), 'index')
  assert.equal(platformPromptAllowed({}), true)
})
