import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../src/index.js'

function tempProfile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-platform-hook-'))
  const plugin = path.join(root, 'node_modules', 'demo')
  fs.mkdirSync(plugin, { recursive: true })
  fs.writeFileSync(path.join(plugin, 'cordis.patch.yml'), '[]\n')
  fs.writeFileSync(path.join(plugin, 'package.json'), JSON.stringify({
    name: 'demo',
    version: '1.0.0',
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      platform: {
        contract: '1.2',
        capabilities: [{ id: 'demo.cap', kind: 'action', title: 'Demo', bind: { tool: 'demo_tool' } }],
        profiles: [
          { id: 'tavern', agentPreset: 'tavern', promptPolicy: { platformPrompts: false, capabilities: 'none' } },
          { id: 'bare', agentPreset: 'bare', capabilities: [] },
        ],
      },
    },
  }))
  return root
}

function fakeAgent(sections, meta = {}) {
  return {
    session: { meta },
    ctx: {
      systemPrompt: {
        section: (value) => sections.push(value.name),
      },
    },
  }
}

test('agent/created honors profile prompt and capability policy', async () => {
  const profile = tempProfile()
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
    apply(ctx, {
      profileDir: profile,
      capabilityBindings: [{ id: 'demo.cap', kind: 'action', bind: { tool: 'demo_tool' } }],
    })
    assert.equal(typeof created, 'function')

    const tavern = []
    created({ agent: fakeAgent(tavern, { agentPreset: 'tavern', profileId: 'tavern' }), source: 'startup' })
    assert.deepEqual(tavern, [])

    const normal = []
    const normalAgent = fakeAgent(normal, { agentPreset: 'default' })
    normalAgent.session.header = { id: 'sess-normal' }
    created({ agent: normalAgent, source: 'startup' })
    assert.ok(normal.includes('platform:creative'))
    assert.ok(normal.includes('platform:tool-failures'))
    assert.ok(normal.includes('platform:capabilities'))

    const firstGeneration = normalAgent.session.meta.generationId
    assert.equal(typeof firstGeneration, 'string')

    const resumed = fakeAgent([], { agentPreset: 'default' })
    resumed.session.header = { id: 'sess-normal' }
    created({ agent: resumed, source: 'startup' })
    assert.equal(resumed.session.meta.generationId, firstGeneration)

    const switched = fakeAgent([], { agentPreset: 'tavern', profileId: 'tavern' })
    switched.session.header = { id: 'sess-normal' }
    created({ agent: switched, source: 'startup' })
    assert.notEqual(switched.session.meta.generationId, firstGeneration)

    const generations = services.get('platformGenerations')
    assert.ok(generations)
    assert.equal(generations.current('sess-normal').id, switched.session.meta.generationId)

    const child = []
    created({ agent: { parent: {}, ctx: { systemPrompt: { section: (v) => child.push(v.name) } }, session: { meta: {} } }, source: 'subagent' })
    assert.deepEqual(child, [])

    const restricted = []
    const bare = {
      session: { meta: { agentPreset: 'bare' } },
      ctx: {
        systemPrompt: { section: () => {} },
        tools: {
          schemas: () => [{ name: 'read' }, { name: 'demo_tool' }],
          restrict: (filter) => restricted.push(filter),
        },
      },
    }
    created({ agent: bare, source: 'startup' })
    const bareProfile = { id: 'bare', agentPreset: 'bare', capabilities: [] }
    await services.get('agentExtensions').sessionReady({ agent: bare, profile: bareProfile })
    assert.deepEqual(restricted[0].deny, ['demo_tool'])
  } finally {
    for (const cleanup of cleanups) cleanup()
    fs.rmSync(profile, { recursive: true, force: true })
  }
})



