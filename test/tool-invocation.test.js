import assert from 'node:assert/strict'
import test from 'node:test'

import { InvocationLedger } from '../src/invocation-ledger.js'
import { createToolInvocationHandler } from '../src/tool-invocation.js'

function execFor(callId, turn = 1, args = { prompt: 'whale' }) {
  const session = {
    header: { id: 'sess-1' },
    snapshotEvents: () => [{ type: 'tool/call', data: { callId, turn } }],
  }
  return { name: 'generate_image', callId, arguments: args, agent: { session } }
}

test('same managed tool call in a turn executes once', async () => {
  const ledger = new InvocationLedger()
  const handler = createToolInvocationHandler({
    invocationLedger: ledger,
    toolCapabilities: new Map([['generate_image', 'image.generate']]),
  })
  let calls = 0
  const next = async () => {
    calls += 1
    return { text: 'image' }
  }
  const first = await handler(execFor('c1'), next)
  const second = await handler(execFor('c2'), next)
  assert.deepEqual(first, { text: 'image' })
  assert.deepEqual(second, { text: 'image' })
  assert.equal(calls, 1)
})

test('concurrent duplicate joins the in-flight owner', async () => {
  const ledger = new InvocationLedger()
  const handler = createToolInvocationHandler({
    invocationLedger: ledger,
    toolCapabilities: new Map([['generate_image', 'image.generate']]),
  })
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let calls = 0
  const next = async () => {
    calls += 1
    await gate
    return { text: 'joined' }
  }
  const first = handler(execFor('c1'), next)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const second = handler(execFor('c2'), next)
  release()
  assert.deepEqual(await first, { text: 'joined' })
  assert.deepEqual(await second, { text: 'joined' })
  assert.equal(calls, 1)
})

test('unmanaged tools bypass the ledger', async () => {
  const handler = createToolInvocationHandler({
    invocationLedger: new InvocationLedger(),
    toolCapabilities: new Map(),
  })
  let calls = 0
  assert.deepEqual(await handler({ name: 'read' }, async () => { calls += 1; return 'ok' }), 'ok')
  assert.equal(calls, 1)
})
