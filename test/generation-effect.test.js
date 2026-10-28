import assert from 'node:assert/strict'
import test from 'node:test'

import { DeliveryCoordinator } from '../src/delivery-coordinator.js'
import { EffectLedger } from '../src/effect-ledger.js'
import { InvocationLedger } from '../src/invocation-ledger.js'

test('delivery keys are generation-scoped and record effects', async () => {
  const effects = new EffectLedger({ generationId: 'g1' })
  const coordinator = new DeliveryCoordinator({ generationId: 'g1', effectLedger: effects })
  const sent = []
  const input = {
    sessionId: 's1',
    turnId: 't1',
    surface: 'qq',
    output: { id: 'out-1' },
    send: async () => sent.push('sent'),
  }
  const first = await coordinator.deliver(input)
  assert.equal(first.delivered, true)
  assert.match(first.key, /^g1\|/)
  const second = await coordinator.deliver(input)
  assert.equal(second.skipped, 'already_delivered')
  assert.equal(sent.length, 1)
  assert.deepEqual(effects.list({ generationId: 'g1' }).map((r) => r.operation), ['create', 'release'])
  assert.deepEqual(effects.stats().states, { pending: 1, delivered: 1 })
})

test('same delivery in another generation is independent', async () => {
  const other = new DeliveryCoordinator({ generationId: 'g2' })
  const input = {
    sessionId: 's1',
    turnId: 't1',
    surface: 'qq',
    output: { id: 'out-1' },
    send: async () => 'ok',
  }
  const g1 = new DeliveryCoordinator({ generationId: 'g1' })
  assert.equal((await g1.deliver(input)).delivered, true)
  assert.equal((await other.deliver(input)).delivered, true)
})

test('invocation claims are generation-scoped', () => {
  const first = new InvocationLedger({ generationId: 'g1' })
  const second = new InvocationLedger({ generationId: 'g2' })
  const input = { sessionId: 's1', turnId: 't1', tool: 'generate_image', args: { prompt: 'x' } }
  const a = first.claim(input)
  const b = second.claim(input)
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  assert.match(a.key, /^g1\|/)
  assert.match(b.key, /^g2\|/)
})
