import assert from 'node:assert/strict'
import test from 'node:test'

import { applyToolExposure } from '../src/tool-exposure.js'

const capabilities = [
  { id: 'image.generate', bind: { tool: 'generate_image' } },
  { id: 'image.edit', bind: { tool: 'edit_image' } },
]

test('tool exposure refuses to guess without schemas and reports it', () => {
  const errors = []
  const agent = { ctx: { tools: { schemas: () => undefined, restrict: () => { throw new Error('should not run') } } } }
  const result = applyToolExposure(agent, {
    capabilities,
    profile: { id: 'image', capabilities: ['image.generate'] },
    onError: (error) => errors.push(error.message),
  })
  assert.equal(result, undefined)
  assert.match(errors[0], /schemas are unavailable/)
})

test('restrict errors are reported with the deny list', () => {
  const errors = []
  const agent = {
    ctx: {
      tools: {
        schemas: () => [{ name: 'generate_image' }, { name: 'edit_image' }],
        restrict: () => { throw new Error('unknown global tool') },
      },
    },
  }
  applyToolExposure(agent, {
    capabilities,
    profile: { id: 'image', capabilities: ['image.generate'] },
    onError: (_error, detail) => errors.push(detail),
  })
  assert.deepEqual(errors[0].deny, ['edit_image'])
})
