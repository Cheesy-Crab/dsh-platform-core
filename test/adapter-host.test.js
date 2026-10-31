import assert from 'node:assert/strict'
import test from 'node:test'

import { AdapterHost } from '../src/adapter-host.js'
import { EffectLedger } from '../src/effect-ledger.js'

function fakeCtx() {
  const services = new Map([
    ['sessionService', { createManager: () => ({ id: 'manager' }), resolveWorkspacesRoot: () => 'root' }],
    ['accessService', { createStore: () => ({ id: 'store' }) }],
  ])
  return { get: (key) => services.get(key) }
}

function fakeRegistry() {
  return { register: () => () => {}, sessionReady: () => 'ready' }
}

test('adapter host injects core services without adapter imports', () => {
  const manager = { id: 'manager' }
  const store = { id: 'store' }
  const registered = []
  const services = new Map([
    ['sessionService', { createManager: () => manager }],
    ['accessService', { createStore: () => store }],
  ])
  const registry = {
    register: (extension) => { registered.push(extension); return () => {} },
    sessionReady: () => 'ready',
  }
  const host = new AdapterHost({
    ctx: { get: (key) => services.get(key) },
    registry,
    log: () => {},
  })
  const mounted = host.mount({
    id: 'test',
    mount: (context) => {
      assert.equal(context.id, 'test')
      assert.equal(context.createSessionManager({}), manager)
      assert.equal(context.createUserStore({}), store)
      context.registerExtensions([{ name: 'demo' }])
      assert.equal(typeof context.forwardMediaOutputs, 'function')
      assert.equal(context.extensions.sessionReady(), 'ready')
      return { stop: () => {} }
    },
  })
  assert.ok(mounted)
  assert.deepEqual(registered, [{ name: 'demo' }])
  host.dispose()
})

test('adapter mount and dispose record lifecycle effects under the plugin owner', () => {
  const effects = new EffectLedger({ generationId: 'g1' })
  const host = new AdapterHost({ ctx: fakeCtx(), registry: fakeRegistry(), effectLedger: effects })
  let owner
  host.mount({
    id: 'qq',
    pluginId: 'dsh-qq-bridge',
    mount: (context) => {
      owner = context.owner
      assert.equal(context.owner.pluginId, 'dsh-qq-bridge')
      assert.match(context.owner.activationId, /^act-/)
      return { stop: () => {} }
    },
  })
  host.dispose()
  assert.deepEqual(effects.list({ pluginId: 'dsh-qq-bridge' }).map((record) => record.operation), ['create', 'release'])
  const released = effects.list({ operation: 'release' })[0]
  assert.equal(released.resourceId, owner.activationId)
})

test('adapter dispose failure is recorded as cleanup-failed', () => {
  const effects = new EffectLedger({ generationId: 'g1' })
  const host = new AdapterHost({ ctx: fakeCtx(), registry: fakeRegistry(), effectLedger: effects, log: () => {} })
  host.mount({
    id: 'qq',
    mount: () => ({
      stop: () => {
        throw new Error('boom')
      },
    }),
  })
  host.dispose()
  const failed = effects.list({ operation: 'cleanup-failed' })
  assert.equal(failed.length, 1)
  assert.equal(failed[0].errorCode, 'adapter-stop-failed')
  assert.equal(failed[0].owner.pluginId, 'qq')
  assert.equal(failed[0].state, 'failed')
})
