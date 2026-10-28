import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PredictionLog } from '../src/prediction-log.js'

test('prediction log appends metadata only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-prediction-log-'))
  const file = path.join(root, 'predictions.jsonl')
  const log = new PredictionLog({ file })
  log.record({
    sessionId: 's1',
    requester: 'qq:1',
    principal: 'qq-group:2',
    source: 'predicted',
    profileId: 'image',
  })
  log.record({ source: 'default', profileId: undefined })
  const entries = log.list()
  assert.equal(entries.length, 2)
  assert.equal(entries[0].profileId, 'image')
  assert.equal(JSON.stringify(entries).includes('prompt'), false)
  assert.deepEqual(log.stats(), { entries: 2 })
  fs.rmSync(root, { recursive: true, force: true })
})
