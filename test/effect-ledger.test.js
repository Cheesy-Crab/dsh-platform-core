import assert from 'node:assert/strict'
import test from 'node:test'

import { EffectLedger } from '../src/effect-ledger.js'

test('effect ledger appends owner-scoped records', () => {
  const ledger = new EffectLedger({ generationId: 'g1' })
  const record = ledger.record({
    owner: { pluginId: 'demo', activationId: 'a1' },
    effectId: 'out-1',
    effectKind: 'media.delivery',
    operation: 'create',
    state: 'pending',
    resourceId: 'file.png',
  })
  assert.equal(record.generationId, 'g1')
  assert.equal(record.sequence, 1)
  assert.equal(record.owner.pluginId, 'demo')
  assert.equal(ledger.list({ pluginId: 'demo' }).length, 1)
  assert.equal(ledger.list({ pluginId: 'other' }).length, 0)
  assert.deepEqual(ledger.stats().operations, { create: 1 })
})

test('effect ledger rejects unknown operations and states', () => {
  const ledger = new EffectLedger()
  assert.throws(() => ledger.record({ effectId: 'x', operation: 'nope' }), /unknown effect operation/)
  assert.throws(() => ledger.record({ effectId: 'x', operation: 'create', state: 'nope' }), /unknown effect state/)
})
