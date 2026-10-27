import assert from 'node:assert/strict'
import test from 'node:test'

import { AdapterHost } from '../src/adapter-host.js'

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
