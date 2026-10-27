import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { InvocationLedger } from '../src/invocation-ledger.js'

const SESSION = 'session-1'
const TURN = 'turn-1'

function input(overrides = {}) {
  return {
    sessionId: SESSION,
    turnId: TURN,
    tool: 'generate_image',
    args: { prompt: 'a cat' },
    ...overrides,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

test('key is session|turn|tool|sha256(normalized args)', () => {
  const ledger = new InvocationLedger()
  const args = { b: 1, a: { d: 2, c: [3, null, 'x'] } }
  const normalized = '{"a":{"c":[3,null,"x"],"d":2},"b":1}'
  const expected = `${SESSION}|${TURN}|generate_image|${createHash('sha256').update(normalized).digest('hex')}`

  const first = ledger.claim(input({ args }))
  assert.equal(first.ok, true)
  assert.equal(first.key, expected)

  // Key order does not change the fingerprint.
  const reordered = ledger.claim(input({ args: { a: { c: [3, null, 'x'], d: 2 }, b: 1 } }))
  assert.equal(reordered.key, expected)
  assert.equal(reordered.reason, 'in_flight')
})

test('identical args are deduped after completion', async () => {
  const ledger = new InvocationLedger()
  const first = ledger.claim(input())
  const settled = await first.run(async () => ({ image: 'cat.png' }))
  assert.deepEqual(settled, { ok: true, key: first.key, result: { image: 'cat.png' } })
  assert.equal(ledger.status(first.key).state, 'completed')

  const duplicate = ledger.claim(input())
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.reason, 'already_completed')
  assert.equal(duplicate.key, first.key)
  assert.deepEqual(duplicate.result, { image: 'cat.png' })
})

test('different args are independent invocations', async () => {
  const ledger = new InvocationLedger()
  const cat = ledger.claim(input({ args: { prompt: 'cat' } }))
  const dog = ledger.claim(input({ args: { prompt: 'dog' } }))
  assert.notEqual(cat.key, dog.key)
  assert.equal(dog.ok, true)

  const [catOutcome, dogOutcome] = await Promise.all([
    cat.run(async () => 'cat.png'),
    dog.run(async () => 'dog.png'),
  ])
  assert.equal(catOutcome.result, 'cat.png')
  assert.equal(dogOutcome.result, 'dog.png')
})

test('concurrent claims single-flight the callback exactly once', async () => {
  const ledger = new InvocationLedger()
  const owner = ledger.claim(input())
  const joiner = ledger.claim(input())

  assert.equal(owner.ok, true)
  assert.equal(owner.owner, true)
  assert.equal(joiner.ok, false)
  assert.equal(joiner.reason, 'in_flight')
  assert.ok(joiner.promise instanceof Promise)

  let executions = 0
  const gate = deferred()
  const running = owner.run(async () => {
    executions += 1
    await gate.promise
    return 'done'
  })
  // Repeating run() on the owner never starts a second execution.
  assert.equal(owner.run(async () => {
    executions += 1
    return 'other'
  }), running)

  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(executions, 1)
  gate.resolve()

  const [primary, shared] = await Promise.all([running, joiner.promise])
  assert.equal(executions, 1)
  assert.deepEqual(primary, { ok: true, key: owner.key, result: 'done' })
  assert.deepEqual(shared, primary)
  assert.equal(ledger.claim(input()).reason, 'already_completed')
})

test('failure releases the key so it can be claimed again', async () => {
  const ledger = new InvocationLedger()
  const owner = ledger.claim(input())
  const joiner = ledger.claim(input())

  await assert.rejects(owner.run(async () => { throw new Error('boom') }), /boom/)

  const failed = ledger.status(owner.key)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.error.message, 'boom')
  assert.deepEqual(await joiner.promise, { ok: false, reason: 'failed', key: owner.key, error: failed.error })

  const retry = ledger.claim(input())
  assert.equal(retry.ok, true)
  assert.equal(retry.key, owner.key)
  assert.equal((await retry.run(async () => 'recovered')).result, 'recovered')
  assert.equal(ledger.status(retry.key).state, 'completed')
})

test('regenerate: true bypasses argument dedupe', async () => {
  const ledger = new InvocationLedger()
  const plain = ledger.claim(input({ args: { prompt: 'cat' } }))
  await plain.run(async () => 'first')

  const regenerate = ledger.claim(input({ args: { prompt: 'cat', regenerate: true } }))
  assert.equal(regenerate.ok, true)
  assert.notEqual(regenerate.key, plain.key)
  assert.equal((await regenerate.run(async () => 'second')).result, 'second')

  const regenerateAgain = ledger.claim(input({ args: { prompt: 'cat', regenerate: true } }))
  assert.equal(regenerateAgain.ok, true)
  assert.equal(regenerateAgain.key, regenerate.key)
  assert.equal((await regenerateAgain.run(async () => 'third')).result, 'third')

  // The plain invocation is still deduped normally.
  assert.equal(ledger.claim(input({ args: { prompt: 'cat' } })).reason, 'already_completed')
})

test('exclusive capability blocks a different tool for the same turn', async () => {
  const ledger = new InvocationLedger()
  const owner = ledger.claim(input({
    tool: 'generate_image',
    args: { prompt: 'cat' },
    capabilityId: 'image.generate',
    exclusive: true,
  }))
  assert.equal(owner.ok, true)
  assert.equal(owner.exclusive, true)

  const blocked = ledger.claim(input({
    tool: 'edit_image',
    args: { prompt: 'paint the cat' },
    capabilityId: 'image.generate',
    exclusive: true,
  }))
  assert.equal(blocked.ok, false)
  assert.equal(blocked.reason, 'exclusive_busy')
  assert.equal(blocked.heldKey, owner.key)
  assert.equal(blocked.capabilityKey, `${SESSION}|${TURN}|capability:image.generate`)

  await owner.run(async () => 'cat.png')

  const cached = ledger.claim(input({
    tool: 'edit_image',
    args: { prompt: 'paint the cat' },
    capabilityId: 'image.generate',
    exclusive: true,
  }))
  assert.equal(cached.ok, false)
  assert.equal(cached.reason, 'already_completed')
  assert.equal(cached.result, 'cat.png')

  // Another capability in the same turn is unaffected.
  const otherCapability = ledger.claim(input({
    tool: 'upscale_image',
    args: { prompt: 'cat' },
    capabilityId: 'image.upscale',
    exclusive: true,
  }))
  assert.equal(otherCapability.ok, true)

  // The mutex is scoped to the turn, not the session.
  const nextTurn = ledger.claim(input({
    turnId: 'turn-2',
    tool: 'edit_image',
    args: { prompt: 'paint the cat' },
    capabilityId: 'image.generate',
    exclusive: true,
  }))
  assert.equal(nextTurn.ok, true)
})

test('exclusive capability is released after a failed execution', async () => {
  const ledger = new InvocationLedger()
  const first = ledger.claim(input({
    tool: 'generate_image',
    args: { prompt: 'cat' },
    capabilityId: 'image.generate',
    exclusive: true,
  }))
  const blocked = ledger.claim(input({
    tool: 'edit_image',
    args: { prompt: 'paint the cat' },
    capabilityId: 'image.generate',
    exclusive: true,
  }))
  assert.equal(blocked.reason, 'exclusive_busy')

  await assert.rejects(first.run(async () => { throw new Error('provider down') }), /provider down/)

  const retry = ledger.claim(input({
    tool: 'edit_image',
    args: { prompt: 'paint the cat' },
    capabilityId: 'image.generate',
    exclusive: true,
  }))
  assert.equal(retry.ok, true)
  assert.equal((await retry.run(async () => 'ok')).result, 'ok')
})

test('regenerate: true still respects capability exclusivity', async () => {
  const ledger = new InvocationLedger()
  const owner = ledger.claim(input({
    args: { prompt: 'cat' },
    capabilityId: 'image.generate',
    exclusive: true,
  }))
  const whileRunning = ledger.claim(input({
    args: { prompt: 'cat', regenerate: true },
    capabilityId: 'image.generate',
    exclusive: true,
  }))
  assert.equal(whileRunning.ok, false)
  assert.equal(whileRunning.reason, 'exclusive_busy')

  await owner.run(async () => 'cat.png')

  const afterCompletion = ledger.claim(input({
    args: { prompt: 'cat', regenerate: true },
    capabilityId: 'image.generate',
    exclusive: true,
  }))
  assert.equal(afterCompletion.ok, false)
  assert.equal(afterCompletion.reason, 'already_completed')
  assert.equal(afterCompletion.result, 'cat.png')
})

test('argument normalization covers nulls, arrays, primitives and cycles', async () => {
  const ledger = new InvocationLedger()
  const execute = async (tool, args) => {
    const claim = ledger.claim(input({ tool, args }))
    assert.equal(claim.ok, true)
    return claim.run(async () => tool)
  }

  await execute('primitive_tool', 'cat')
  assert.equal(ledger.claim(input({ tool: 'primitive_tool', args: 'cat' })).reason, 'already_completed')
  assert.equal(ledger.claim(input({ tool: 'primitive_tool', args: 'dog' })).ok, true)

  await execute('array_tool', [1, 2, 3])
  assert.equal(ledger.claim(input({ tool: 'array_tool', args: [1, 2, 3] })).reason, 'already_completed')
  assert.equal(ledger.claim(input({ tool: 'array_tool', args: [3, 2, 1] })).ok, true)

  await execute('null_tool', null)
  assert.equal(ledger.claim(input({ tool: 'null_tool', args: null })).reason, 'already_completed')
  assert.equal(ledger.claim(input({ tool: 'null_tool', args: undefined })).reason, 'already_completed')

  const circular = { prompt: 'cat' }
  circular.self = circular
  await execute('circular_tool', circular)
  const circularAgain = { prompt: 'cat' }
  circularAgain.self = circularAgain
  assert.equal(ledger.claim(input({ tool: 'circular_tool', args: circularAgain })).reason, 'already_completed')
})

test('status reports unknown, in_flight, completed and failed', async () => {
  const ledger = new InvocationLedger()
  assert.deepEqual(ledger.status('no-such-key'), { key: 'no-such-key', state: 'unknown' })

  const owner = ledger.claim(input())
  assert.equal(ledger.status(owner.key).state, 'in_flight')
  await owner.run(async () => 'done')
  const completed = ledger.status(owner.key)
  assert.equal(completed.state, 'completed')
  assert.equal(completed.result, 'done')

  const failing = ledger.claim(input({ args: { prompt: 'dog' } }))
  ledger.fail(failing.key, new Error('nope'))
  const failed = ledger.status(failing.key)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.error.message, 'nope')
})

test('optional logger is observed and cannot break the ledger', async () => {
  const events = []
  const ledger = new InvocationLedger({
    log: (level, message) => {
      events.push({ level, message })
      throw new Error('logger exploded')
    },
  })
  const claim = ledger.claim(input())
  const outcome = await claim.run(async () => 'ok')
  assert.equal(outcome.result, 'ok')
  assert.ok(events.length >= 2)
  assert.ok(events.some((event) => event.level === 'debug'))
})

test('claim validates session, turn and tool', () => {
  const ledger = new InvocationLedger()
  assert.throws(() => ledger.claim(), TypeError)
  assert.throws(() => ledger.claim({ sessionId: SESSION, tool: 'generate_image' }), TypeError)
  assert.throws(() => ledger.claim({ sessionId: SESSION, turnId: TURN, tool: '' }), TypeError)
})
