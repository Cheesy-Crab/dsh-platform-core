import assert from 'node:assert/strict'
import test from 'node:test'

import { DeliveryCoordinator } from '../src/delivery-coordinator.js'
import { forwardMediaOutputs } from '../src/delivery.js'

function sessionWithImage() {
  return {
    ownEvents: () => [{
      seq: 1,
      type: 'tool/result',
      data: {
        meta: {
          dsh: {
            outputs: [{ kind: 'image', path: 'C:/tmp/whale.png' }],
          },
        },
      },
    }],
  }
}

test('forwardMediaOutputs uses the coordinator to send once per turn', async () => {
  const coordinator = new DeliveryCoordinator()
  const sent = []
  const options = {
    sendImage: async (chat, file) => sent.push(file),
    chat: { type: 'group', id: 'g1' },
    session: sessionWithImage(),
    state: {},
    fromSeq: 0,
    deliveryCoordinator: coordinator,
    sessionId: 's1',
    turnId: 't1',
    surface: 'qq',
  }
  const first = await forwardMediaOutputs(options)
  const second = await forwardMediaOutputs(options)
  assert.deepEqual(first, ['C:/tmp/whale.png'])
  assert.deepEqual(second, [])
  assert.deepEqual(sent, ['C:/tmp/whale.png'])
})
