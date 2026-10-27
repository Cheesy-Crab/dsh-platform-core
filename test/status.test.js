import assert from 'node:assert/strict'
import test from 'node:test'

import { createPlatformStatus } from '../src/status.js'

test('platform status is a read-only snapshot of counts', () => {
  const status = createPlatformStatus({
    pluginRegistry: { describe: () => ({ plugins: 2 }), capabilities: () => [{}, {}] },
    profileRegistry: { describe: () => ({ profiles: 1 }) },
    deliveryCoordinator: { stats: () => ({ delivered: 3 }) },
    invocationLedger: { stats: () => ({ completed: 2 }) },
  })()
  assert.deepEqual(status, {
    plugins: { plugins: 2 },
    capabilities: 2,
    profiles: { profiles: 1 },
    delivery: { delivered: 3 },
    invocations: { completed: 2 },
  })
})
