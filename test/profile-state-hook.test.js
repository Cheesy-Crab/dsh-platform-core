import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../src/index.js'

test('profile-state extension records turn tool usage', async () => {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-profile-state-hook-'))
  const stateDir = path.join(profileDir, 'state')
  const services = new Map()
  const cleanups = []
  const ctx = {
    logger: {},
    get: (key) => services.get(key),
    provide: (key, value) => services.set(key, value),
    effect: (factory) => {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
  try {
    apply(ctx, { profileDir, profileStateDir: stateDir })
    const session = {
      header: { id: 's1' },
      ownEvents: () => [
        { seq: 1, type: 'tool/call', data: { callId: 'c1', name: 'generate_image' } },
        { seq: 2, type: 'tool/result', data: { callId: 'c1', message: { isError: false } } },
      ],
    }
    await services.get('agentExtensions').turnEnd({
      session,
      state: { profileId: 'image', key: 'private:1' },
      fromSeq: 0,
    })
    const snapshot = services.get('profileState').snapshot('image')
    assert.equal(snapshot.totals.turns, 1)
    assert.equal(snapshot.tools.generate_image.calls, 1)
    assert.equal(snapshot.tools.generate_image.successes, 1)
    assert.equal(snapshot.tools.generate_image.capabilityId, 'image.generate')
  } finally {
    for (const cleanup of cleanups) cleanup()
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})
