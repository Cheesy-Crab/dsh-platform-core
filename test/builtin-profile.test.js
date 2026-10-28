import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../src/index.js'

function tempProfile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-builtin-profile-'))
  const image = path.join(root, 'node_modules', 'dsh-image-gen')
  fs.mkdirSync(image, { recursive: true })
  fs.writeFileSync(path.join(image, 'package.json'), JSON.stringify({ name: 'dsh-image-gen', version: '0.9.2' }))
  return root
}

test('image-gen install adds a built-in image profile with scoped tools', async () => {
  const profileDir = tempProfile()
  const services = new Map()
  let created
  const cleanups = []
  const ctx = {
    logger: {},
    get: (key) => services.get(key),
    provide: (key, value) => services.set(key, value),
    effect: (factory) => {
      const cleanup = factory()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    on: (event, handler) => {
      if (event === 'agent/created') created = handler
      return () => {}
    },
  }
  try {
    apply(ctx, { profileDir })
    const imageProfile = services.get('conversationProfiles').get('image')
    assert.deepEqual(imageProfile.capabilities, ['image.generate'])

    const restricted = []
    const sections = []
    const agent = {
      session: { meta: { agentPreset: 'standard' } },
      ctx: {
        systemPrompt: { section: (value) => sections.push(value.name) },
        tools: {
          schemas: () => [
            { name: 'read' },
            { name: 'generate_image' },
            { name: 'edit_image' },
            { name: 'find_inspiration' },
          ],
          restrict: (filter) => restricted.push(filter),
        },
      },
    }
    created({ agent, source: 'startup' })
    await services.get('agentExtensions').sessionReady({ agent, profile: imageProfile })
    assert.ok(sections.includes('platform:capabilities'))
    assert.deepEqual(restricted[0].deny.sort(), ['edit_image', 'find_inspiration'])
  } finally {
    for (const cleanup of cleanups) cleanup()
    fs.rmSync(profileDir, { recursive: true, force: true })
  }
})
