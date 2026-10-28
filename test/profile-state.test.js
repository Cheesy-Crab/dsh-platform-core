import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { ProfileStateStore } from '../src/profile-state.js'
import { collectToolUsage, toolCapabilityMap } from '../src/tool-usage.js'

test('profile state persists tool counters and never stores arguments', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-state-'))
  const store = new ProfileStateStore({ root })
  store.recordToolUse({
    profileId: 'image',
    tool: 'generate_image',
    capabilityId: 'image.generate',
    outcome: 'success',
    sessionId: 's1',
  })
  store.recordToolUse({
    profileId: 'image',
    tool: 'generate_image',
    capabilityId: 'image.generate',
    outcome: 'failure',
    sessionId: 's1',
  })
  const state = store.save('image')
  assert.deepEqual(state.tools.generate_image.calls, 2)
  assert.deepEqual(state.tools.generate_image.successes, 1)
  assert.deepEqual(state.tools.generate_image.failures, 1)
  assert.equal(state.capabilities['image.generate'].calls, 2)
  assert.equal(state.sessions.s1.calls, 2)
  const text = fs.readFileSync(path.join(root, 'image.json'), 'utf8')
  assert.equal(text.includes('prompt'), false)
  assert.equal(text.includes('arguments'), false)
})

test('tool usage collector pairs calls and results', () => {
  const events = [
    { type: 'tool/call', data: { callId: 'c1', name: 'generate_image' } },
    { type: 'tool/result', data: { callId: 'c1', message: { isError: false } } },
    { type: 'tool/call', data: { callId: 'c2', name: 'edit_image' } },
    { type: 'tool/result', data: { callId: 'c2', message: { isError: true } } },
  ]
  const usage = collectToolUsage(events, {
    toolCapability: toolCapabilityMap([
      { id: 'image.generate', bind: { tool: 'generate_image' } },
      { id: 'image.edit', bind: { tool: 'edit_image' } },
    ]),
  })
  assert.deepEqual(usage, [
    { tool: 'generate_image', capabilityId: 'image.generate', outcome: 'success' },
    { tool: 'edit_image', capabilityId: 'image.edit', outcome: 'failure' },
  ])
})
