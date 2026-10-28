import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createProfilePredictor } from '../src/profile-predictor.js'
import { UserCapabilityStore } from '../src/user-capability-state.js'

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-user-cap-'))
  const users = new UserCapabilityStore({ root })
  const image = { id: 'image', agentPreset: 'standard', capabilities: ['image.generate'], families: ['image'] }
  const tavern = { id: 'tavern', agentPreset: 'tavern' }
  const profiles = { list: () => [image, tavern], get: (id) => [image, tavern].find((p) => p.id === id) }
  const capabilities = [{ id: 'image.generate', family: 'image' }, { id: 'image.edit', family: 'image' }]
  return { root, users, profiles, capabilities }
}

test('predictor returns the profile matching a user hot capability', () => {
  const { root, users, profiles, capabilities } = setup()
  for (let i = 0; i < 4; i += 1) {
    users.recordTurn({
      userId: 'qq:710711549',
      tools: [{ capabilityId: 'image.edit', outcome: 'success' }],
    })
  }
  const predictor = createProfilePredictor({ profiles, userState: users, capabilities })
  const predicted = predictor.predict({ agent: { session: { meta: { requester: 'qq:710711549', agentPreset: 'standard' } } } })
  assert.equal(predicted.id, 'image')
  fs.rmSync(root, { recursive: true, force: true })
})

test('predictor stays quiet below the sample threshold', () => {
  const { root, users, profiles, capabilities } = setup()
  users.recordTurn({ userId: 'qq:1', tools: [{ capabilityId: 'image.generate', outcome: 'success' }] })
  const predictor = createProfilePredictor({ profiles, userState: users, capabilities, minCalls: 3 })
  assert.equal(predictor.predict({ agent: { session: { meta: { requester: 'qq:1', agentPreset: 'standard' } } } }), undefined)
  fs.rmSync(root, { recursive: true, force: true })
})

test('group prediction uses the group principal, not the sender', () => {
  const { root, users, profiles, capabilities } = setup()
  for (let i = 0; i < 4; i += 1) {
    users.recordTurn({
      userId: 'qq-group:99',
      tools: [{ capabilityId: 'image.generate', outcome: 'success' }],
    })
  }
  const predictor = createProfilePredictor({ profiles, userState: users, capabilities })
  const predicted = predictor.predict({
    agent: {
      session: {
        meta: {
          requester: 'qq:1',
          principal: 'qq-group:99',
          agentPreset: 'standard',
        },
      },
    },
  })
  assert.equal(predicted.id, 'image')
  fs.rmSync(root, { recursive: true, force: true })
})
