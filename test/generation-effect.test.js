import assert from 'node:assert/strict'
import test from 'node:test'

import { DeliveryCoordinator } from '../src/delivery-coordinator.js'
import { EffectLedger } from '../src/effect-ledger.js'
import { GenerationRegistry } from '../src/generation.js'
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

test('delivery from a retired generation is rejected without sending', async () => {
  const generations = new GenerationRegistry()
  const first = generations.forSession('s1', { profileId: 'image' })
  const effects = new EffectLedger({ generationId: 'g1' })
  const coordinator = new DeliveryCoordinator({ generationId: 'g1', effectLedger: effects, generations })
  const sent = []
  const input = {
    sessionId: 's1',
    turnId: 't1',
    surface: 'qq',
    output: { id: 'out-1' },
    send: async () => sent.push('sent'),
  }
  assert.equal((await coordinator.deliver({ ...input, generationId: first.id })).delivered, true)

  const second = generations.forSession('s1', { profileId: 'tavern' })
  assert.notEqual(second.id, first.id)

  const stale = await coordinator.deliver({ ...input, turnId: 't2', generationId: first.id })
  assert.equal(stale.skipped, 'stale_generation')
  assert.equal(sent.length, 1)

  const fresh = await coordinator.deliver({ ...input, turnId: 't2', generationId: second.id })
  assert.equal(fresh.delivered, true)
  assert.equal(sent.length, 2)
})

test('invocation claims from a retired generation are rejected', () => {
  const generations = new GenerationRegistry()
  const generation = generations.forSession('s1', { profileId: 'image' })
  const ledger = new InvocationLedger({ generationId: 'process', generations })
  const input = { sessionId: 's1', turnId: 't1', tool: 'generate_image', args: { prompt: 'x' } }
  const claimed = ledger.claim({ ...input, generationId: generation.id })
  assert.equal(claimed.ok, true)
  assert.match(claimed.key, new RegExp(`^${generation.id}\\|`))

  generations.forSession('s1', { profileId: 'tavern' })
  const stale = ledger.claim({ ...input, turnId: 't2', generationId: generation.id })
  assert.equal(stale.ok, false)
  assert.equal(stale.reason, 'stale_generation')
})

test('delivery records the adapter owner in the effect ledger', async () => {
  const effects = new EffectLedger({ generationId: 'g1' })
  const coordinator = new DeliveryCoordinator({ generationId: 'g1', effectLedger: effects })
  await coordinator.deliver({
    sessionId: 's1',
    turnId: 't1',
    surface: 'qq',
    output: { id: 'out-1' },
    send: async () => 'ok',
    owner: { pluginId: 'dsh-qq-bridge', activationId: 'act-1' },
  })
  const owners = new Set(effects.list({ generationId: 'g1' }).map((record) => `${record.owner.pluginId}/${record.owner.activationId}`))
  assert.deepEqual([...owners], ['dsh-qq-bridge/act-1'])
})
