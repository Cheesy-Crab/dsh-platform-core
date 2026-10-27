import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCapabilityBrief,
  installCapabilityPrompt,
} from '../src/prompts/capabilities.prompt.js'

const SECTION_NAME = 'platform:capabilities'
const SECTION_ORDER = 150

function lines(brief) {
  return brief.split('\n')
}

function createAgent() {
  const sections = []
  const agent = {
    sections,
    throwOnSection: false,
    ctx: {
      systemPrompt: {
        section(section) {
          if (agent.throwOnSection) throw new Error('boom')
          sections.push(section)
        },
      },
    },
  }
  return agent
}

test('buildCapabilityBrief renders one line per capability with tool and delivery', () => {
  const brief = buildCapabilityBrief([
    {
      id: 'image.generate',
      kind: 'action',
      title: '生成图片',
      description: '按提示词生成一张图片',
      bind: { tool: 'image_generate' },
      delivery: ['image'],
    },
    {
      id: 'memory.recall',
      kind: 'memory',
      description: '按关键词召回历史消息',
    },
  ])

  assert.equal(brief, [
    '- image.generate（action）：生成图片；tool: image_generate；delivery: image',
    '- memory.recall（memory）：按关键词召回历史消息',
  ].join('\n'))
})

test('buildCapabilityBrief filters internal ids, invalid entries and empty input', () => {
  assert.equal(buildCapabilityBrief(), '')
  assert.equal(buildCapabilityBrief([]), '')
  assert.equal(buildCapabilityBrief(null), '')
  assert.equal(buildCapabilityBrief([null, undefined, {}, { id: '' }, { id: '   ' }]), '')
  assert.equal(buildCapabilityBrief([
    { id: 'platform.core', kind: 'knowledge', title: 'Platform Core' },
    { id: 'session.core', kind: 'memory', title: 'Session Core' },
  ]), '')
  assert.equal(buildCapabilityBrief([
    { id: 'platform.core', kind: 'knowledge' },
    { id: 'image.generate', kind: 'action', title: '生成图片' },
  ]), '- image.generate（action）：生成图片')
})

test('buildCapabilityBrief deduplicates by id, sorts by id and keeps input intact', () => {
  const input = [
    { id: 'b.two', kind: 'action', title: '第二个' },
    { id: 'a.one', kind: 'action', title: '第一个' },
    { id: 'b.two', kind: 'action', title: '重复项' },
  ]

  assert.deepEqual(lines(buildCapabilityBrief(input)), [
    '- a.one（action）：第一个',
    '- b.two（action）：第二个',
  ])
  assert.deepEqual(input.map((item) => item.id), ['b.two', 'a.one', 'b.two'])
  assert.equal(lines(buildCapabilityBrief(input)).filter((line) => line.startsWith('- b.two')).length, 1)
})

test('buildCapabilityBrief collapses whitespace and truncates long text', () => {
  const long = 'x'.repeat(200)
  const titled = lines(buildCapabilityBrief([
    { id: 'x.long', kind: 'action', title: '  长\n标题  ', description: long },
  ]))[0]
  assert.ok(!titled.includes('\n'))
  assert.ok(titled.startsWith('- x.long（action）：长 标题'))

  const described = lines(buildCapabilityBrief([
    { id: 'y.desc', kind: 'action', description: long },
  ]))[0]
  const text = described.slice(described.indexOf('：') + 1)
  assert.ok(text.endsWith('…'))
  assert.equal(text.length, 80)
})

test('buildCapabilityBrief omits optional parts it cannot render', () => {
  const brief = buildCapabilityBrief([
    {
      id: 'plain.thing',
      title: '无类型',
      bind: {},
      delivery: [],
    },
  ])
  assert.equal(brief, '- plain.thing：无类型')
})

test('buildCapabilityBrief groups the overflow by kind instead of adding lines', () => {
  const capabilities = [
    { id: 'a.one', kind: 'action', title: 'A' },
    { id: 'b.two', kind: 'knowledge', title: 'B' },
    { id: 'c.three', kind: 'action', title: 'C' },
    { id: 'd.four', kind: 'tool', title: 'D' },
    { id: 'e.five', kind: 'knowledge', title: 'E' },
  ]

  const brief = buildCapabilityBrief(capabilities, { max: 2 })
  const out = lines(brief)

  assert.equal(out.length, 3)
  assert.deepEqual(out.slice(0, 2), [
    '- a.one（action）：A',
    '- b.two（knowledge）：B',
  ])
  assert.equal(out[2], '- 另有 3 个能力：action 1、knowledge 1、tool 1')

  // Repeated kinds are counted together.
  const grouped = lines(buildCapabilityBrief([
    { id: 'a.one', kind: 'action', title: 'A' },
    { id: 'b.two', kind: 'action', title: 'B' },
    { id: 'c.three', kind: 'action', title: 'C' },
    { id: 'd.four', kind: 'knowledge', title: 'D' },
  ], { max: 1 }))
  assert.equal(grouped.length, 2)
  assert.equal(grouped[1], '- 另有 3 个能力：action 2、knowledge 1')

  // No summary line when everything fits.
  assert.equal(lines(buildCapabilityBrief(capabilities.slice(0, 2), { max: 2 })).length, 2)
})

test('buildCapabilityBrief defaults to 20 individual lines', () => {
  const capabilities = Array.from({ length: 25 }, (_, index) => ({
    id: `cap.${String(index).padStart(2, '0')}`,
    kind: index % 2 === 0 ? 'action' : 'knowledge',
    title: `能力 ${index}`,
  }))

  const out = lines(buildCapabilityBrief(capabilities))
  assert.equal(out.length, 21)
  assert.equal(out.slice(0, 20).filter((line) => line.startsWith('- cap.')).length, 20)
  assert.equal(out[20], '- 另有 5 个能力：action 3、knowledge 2')
})

test('installCapabilityPrompt adds one section and is idempotent', () => {
  const agent = createAgent()
  const state = {}

  assert.equal(installCapabilityPrompt(agent, state, '能力清单'), true)
  assert.deepEqual(agent.sections, [{
    name: SECTION_NAME,
    order: SECTION_ORDER,
    text: '能力清单',
  }])
  assert.equal(state.capabilitiesPromptInstalled, true)
  assert.equal(agent.__platformCapabilitiesInstalled, true)

  assert.equal(installCapabilityPrompt(agent, state, '能力清单'), false)
  assert.equal(installCapabilityPrompt(agent, {}, '能力清单'), false)
  assert.equal(agent.sections.length, 1)
})

test('installCapabilityPrompt skips empty briefs and already marked agents', () => {
  const empty = createAgent()
  assert.equal(installCapabilityPrompt(empty, {}, '', () => {}), false)
  assert.equal(installCapabilityPrompt(empty, {}, undefined, () => {}), false)
  assert.equal(installCapabilityPrompt(empty, {}, '   ', () => {}), false)
  assert.equal(empty.sections.length, 0)

  const markedState = createAgent()
  assert.equal(installCapabilityPrompt(markedState, { capabilitiesPromptInstalled: true }, 'x'), false)
  assert.equal(markedState.sections.length, 0)

  const markedAgent = createAgent()
  markedAgent.__platformCapabilitiesInstalled = true
  assert.equal(installCapabilityPrompt(markedAgent, {}, 'x'), false)
  assert.equal(markedAgent.sections.length, 0)
})

test('installCapabilityPrompt only marks on success and can retry after failure', () => {
  const agent = createAgent()
  const state = {}
  const warnings = []

  agent.throwOnSection = true
  assert.equal(installCapabilityPrompt(agent, state, '能力清单', (level, message) => {
    warnings.push([level, message])
  }), false)
  assert.equal(state.capabilitiesPromptInstalled, undefined)
  assert.equal(agent.__platformCapabilitiesInstalled, undefined)
  assert.deepEqual(warnings.map(([level]) => level), ['warn'])
  assert.match(warnings[0][1], /capability prompt/)
  assert.match(warnings[0][1], /boom/)

  agent.throwOnSection = false
  assert.equal(installCapabilityPrompt(agent, state, '能力清单'), true)
  assert.equal(agent.sections.length, 1)
  assert.equal(state.capabilitiesPromptInstalled, true)
  assert.equal(agent.__platformCapabilitiesInstalled, true)
})

test('installCapabilityPrompt tolerates a missing state object', () => {
  const agent = createAgent()
  assert.equal(installCapabilityPrompt(agent, undefined, '能力清单'), true)
  assert.equal(agent.sections.length, 1)
  assert.equal(agent.__platformCapabilitiesInstalled, true)
  assert.equal(installCapabilityPrompt(agent, undefined, '能力清单'), false)
  assert.equal(agent.sections.length, 1)
})
