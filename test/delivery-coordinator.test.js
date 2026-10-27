import assert from 'node:assert/strict'
import test from 'node:test'

import { DeliveryCoordinator, outputIdOf } from '../src/delivery-coordinator.js'

const turn = {
  sessionId: 'session-1',
  turnId: 'turn-1',
  surface: 'qq',
  target: { chatId: 'chat-1' },
}

const output = {
  id: 'image-1',
  path: 'C:/tmp/image-1.png',
  size: 1024,
  mtime: 1700000000000,
}

function delivery(overrides = {}) {
  return { ...turn, output, send: async () => 'sent', ...overrides }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const KEY = 'session-1|turn-1|qq|image-1'

test('duplicate delivery is skipped without calling send again', async () => {
  const calls = []
  const send = async (receivedOutput, receivedTarget) => {
    calls.push([receivedOutput, receivedTarget])
    return 'sent'
  }
  const coordinator = new DeliveryCoordinator()

  const first = await coordinator.deliver(delivery({ send }))
  assert.equal(first.delivered, true)
  assert.equal(first.key, KEY)
  assert.equal(first.outputId, 'image-1')
  assert.equal(first.result, 'sent')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], output)
  assert.equal(calls[0][1], turn.target)

  const second = await coordinator.deliver(delivery({ send }))
  assert.deepEqual(second, {
    skipped: 'already_delivered',
    key: KEY,
    outputId: 'image-1',
  })
  assert.equal(calls.length, 1)
})

test('concurrent deliveries for the same key single-flight one send', async () => {
  const gate = deferred()
  let sends = 0
  const send = async () => {
    sends += 1
    await gate.promise
    return 'shared-result'
  }
  const coordinator = new DeliveryCoordinator()

  const attempts = Array.from({ length: 5 }, () => coordinator.deliver(delivery({ send })))
  await Promise.resolve()
  assert.equal(sends, 1)

  gate.resolve()
  const results = await Promise.all(attempts)
  assert.equal(sends, 1)
  for (const result of results) {
    assert.deepEqual(result, results[0])
    assert.equal(result.delivered, true)
    assert.equal(result.result, 'shared-result')
  }
  assert.ok(results.every((result) => result === results[0]))
  assert.equal(coordinator.status({ ...turn, outputId: 'image-1' }).state, 'delivered')
})

test('failed send releases the claim and a retry succeeds', async () => {
  const failure = new Error('transport down')
  const gate = deferred()
  let sends = 0
  const coordinator = new DeliveryCoordinator({ log: () => {} })
  const send = async () => {
    sends += 1
    await gate.promise
    throw failure
  }

  const first = coordinator.deliver(delivery({ send }))
  const second = coordinator.deliver(delivery({ send }))
  await Promise.resolve()
  assert.equal(sends, 1)

  gate.reject(failure)
  const settled = await Promise.allSettled([first, second])
  assert.equal(settled[0].status, 'rejected')
  assert.equal(settled[1].status, 'rejected')
  assert.equal(settled[0].reason, failure)
  assert.equal(settled[1].reason, failure)

  const failed = coordinator.status({ ...turn, outputId: 'image-1' })
  assert.equal(failed.state, 'failed')
  assert.equal(failed.error, failure)

  const retry = await coordinator.deliver(delivery({ send: async () => 'retried' }))
  assert.equal(retry.delivered, true)
  assert.equal(retry.result, 'retried')
  assert.equal(sends, 1)
  assert.equal(coordinator.status({ ...turn, outputId: 'image-1' }).state, 'delivered')
})

test('status reports unknown, pending, delivered and failed states', async () => {
  const gate = deferred()
  let attempt = 0
  const send = async () => {
    attempt += 1
    if (attempt === 1) {
      await gate.promise
      return 'ok'
    }
    throw new Error('send failed')
  }
  const coordinator = new DeliveryCoordinator()
  const query = { ...turn, outputId: 'image-1' }

  assert.deepEqual(coordinator.status(query), {
    state: 'unknown',
    key: KEY,
    outputId: 'image-1',
  })

  const pendingDelivery = coordinator.deliver(delivery({ send }))
  await Promise.resolve()
  assert.deepEqual(coordinator.status(query), {
    state: 'pending',
    key: KEY,
    outputId: 'image-1',
  })

  gate.resolve()
  await pendingDelivery
  assert.deepEqual(coordinator.status(query), {
    state: 'delivered',
    key: KEY,
    outputId: 'image-1',
  })

  await assert.rejects(
    coordinator.deliver(delivery({ output: { id: 'image-2' }, send })),
    /send failed/,
  )
  const failed = coordinator.status({ ...turn, outputId: 'image-2' })
  assert.equal(failed.state, 'failed')
  assert.equal(failed.key, 'session-1|turn-1|qq|image-2')
  assert.equal(failed.outputId, 'image-2')

  assert.deepEqual(coordinator.status({ sessionId: 'session-1' }), {
    state: 'unknown',
    key: null,
    outputId: null,
  })
})

test('deliveries are scoped by session, turn and surface', async () => {
  const coordinator = new DeliveryCoordinator()
  let sends = 0
  const send = async () => {
    sends += 1
    return 'ok'
  }

  const attempts = [
    delivery({ send }),
    delivery({ send, turnId: 'turn-2' }),
    delivery({ send, surface: 'web' }),
    delivery({ send, sessionId: 'session-2' }),
  ]
  const results = await Promise.all(attempts.map((input) => coordinator.deliver(input)))
  assert.equal(sends, 4)
  assert.equal(new Set(results.map((result) => result.key)).size, 4)
})

test('output identity prefers id and fingerprints path metadata', () => {
  assert.equal(outputIdOf({ id: 'explicit', path: '/tmp/a.png' }), 'explicit')
  assert.equal(outputIdOf({ id: '', path: '/tmp/a.png' }), '/tmp/a.png')
  assert.equal(
    outputIdOf({ path: '/tmp/a.png', size: 10, mtime: 20 }),
    outputIdOf({ path: '/tmp/a.png', size: 10, mtime: 20 }),
  )
  assert.notEqual(
    outputIdOf({ path: '/tmp/a.png', size: 10 }),
    outputIdOf({ path: '/tmp/a.png', size: 11 }),
  )
  assert.match(outputIdOf({ path: '/tmp/a.png', size: 10, mtime: 20 }), /^sha256:[a-f0-9]{64}$/)
  assert.equal(
    outputIdOf({ path: '/tmp/a.png', mtime: new Date(1700000000000) }),
    outputIdOf({ path: '/tmp/a.png', mtime: 1700000000000 }),
  )
  assert.throws(() => outputIdOf({}), TypeError)
  assert.throws(() => outputIdOf(null), TypeError)
})
