/**
 * Capability brief prompt. It summarizes the discovered capability registry
 * as a short, stable list so the active agent knows which capabilities exist
 * and which tool implements each one. It names no surface, transport or
 * provider.
 */

/** Core plugin capabilities are runtime plumbing, not user-facing abilities. */
const INTERNAL_IDS = new Set(['platform.core', 'session.core'])

const DEFAULT_MAX = 20
const MAX_LABEL = 80
const MAX_EXTRA = 60

function normalizeMax(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_MAX
  return Math.max(0, Math.floor(number))
}

function textOf(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** Collapse whitespace to one line and truncate without losing the marker. */
function shorten(value, limit) {
  const text = textOf(value).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1).trimEnd()}…`
}

function labelOf(capability) {
  return shorten(capability.title, MAX_LABEL)
    || shorten(capability.description, MAX_LABEL)
}

function formatDelivery(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => textOf(item).trim())
      .filter(Boolean)
      .join(', ')
  }
  return textOf(value).trim()
}

function compareIds(left, right) {
  if (left.id < right.id) return -1
  if (left.id > right.id) return 1
  return 0
}

function formatCapability(entry) {
  const { id, capability } = entry
  let line = `- ${id}`
  const kind = shorten(capability.kind, 40)
  if (kind) line += `（${kind}）`
  const label = labelOf(capability)
  if (label) line += `：${label}`
  const tool = shorten(capability.bind?.tool, MAX_EXTRA)
  if (tool) line += `；tool: ${tool}`
  const delivery = shorten(formatDelivery(capability.delivery), MAX_EXTRA)
  if (delivery) line += `；delivery: ${delivery}`
  return line
}

function formatRemainder(entries) {
  const counts = new Map()
  for (const { capability } of entries) {
    const kind = shorten(capability.kind, 40) || 'other'
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const detail = [...counts.entries()]
    .sort((left, right) => (right[1] - left[1]) || compareIds(
      { id: left[0] },
      { id: right[0] },
    ))
    .map(([kind, count]) => `${kind} ${count}`)
    .join('、')
  return `- 另有 ${entries.length} 个能力：${detail}`
}

/**
 * Build a compact brief for a capability list. Internal ids are dropped,
 * duplicate ids keep their first occurrence, and the rest is sorted by id so
 * the prompt is stable across runs. At most `max` capabilities get their own
 * line; the remainder is summarized by kind.
 *
 * @param {Array<object>} capabilities
 * @param {{ max?: number }} [options]
 * @returns {string} newline-joined brief, or '' when nothing is usable
 */
export function buildCapabilityBrief(capabilities, { max = DEFAULT_MAX } = {}) {
  const limit = normalizeMax(max)
  const seen = new Set()
  const entries = []

  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    if (capability === null || typeof capability !== 'object') continue
    const id = textOf(capability.id).trim()
    if (!id || INTERNAL_IDS.has(id) || seen.has(id)) continue
    seen.add(id)
    entries.push({ id, capability })
  }

  entries.sort(compareIds)

  const lines = entries.slice(0, limit).map(formatCapability)
  const remainder = entries.slice(limit)
  if (remainder.length > 0) lines.push(formatRemainder(remainder))
  return lines.join('\n')
}

/**
 * Install the capability brief as a read-only system-prompt section. The
 * section is added at most once per agent; failures leave no marker so a
 * later session pass can retry.
 *
 * @param {any} agent
 * @param {{ capabilitiesPromptInstalled?: boolean }} state
 * @param {string} brief
 * @param {(level: string, message: string) => void} [log]
 * @returns {boolean} true when this call installed the section
 */
export function installCapabilityPrompt(agent, state, brief, log) {
  if (typeof brief !== 'string' || brief.trim() === '') return false
  if (state?.capabilitiesPromptInstalled || agent?.__platformCapabilitiesInstalled) return false
  try {
    agent.ctx.systemPrompt.section({
      name: 'platform:capabilities',
      order: 150,
      text: brief,
    })
    agent.__platformCapabilitiesInstalled = true
    if (state) state.capabilitiesPromptInstalled = true
    return true
  } catch (error) {
    log?.('warn', `could not add capability prompt: ${error?.message ?? error}`)
    return false
  }
}
