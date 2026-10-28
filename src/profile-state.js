import fs from 'node:fs'
import path from 'node:path'

const SCHEMA_VERSION = 1

function safeId(value) {
  const text = String(value ?? '')
  const cleaned = text.replace(/[^A-Za-z0-9._-]/g, '_')
  return cleaned.length > 0 ? cleaned : 'unknown'
}

function defaultState(profileId) {
  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    profileId,
    createdAt: now,
    updatedAt: now,
    tools: {},
    capabilities: {},
    sessions: {},
    totals: {
      toolCalls: 0,
      successes: 0,
      failures: 0,
      turns: 0,
    },
  }
}

function normalizeState(profileId, raw) {
  const base = defaultState(profileId)
  if (!raw || typeof raw !== 'object') return base
  return {
    ...base,
    ...raw,
    profileId,
    tools: raw.tools && typeof raw.tools === 'object' ? raw.tools : {},
    capabilities: raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : {},
    sessions: raw.sessions && typeof raw.sessions === 'object' ? raw.sessions : {},
    totals: { ...base.totals, ...(raw.totals && typeof raw.totals === 'object' ? raw.totals : {}) },
  }
}

/**
 * Persistent profile-scoped state. It intentionally stores counters and
 * timestamps only, never prompts, message text, paths or tool arguments.
 */
export class ProfileStateStore {
  constructor({ root, log, now = () => new Date() } = {}) {
    this.root = root
    this.log = log
    this.now = now
    this.cache = new Map()
  }

  fileFor(profileId) {
    return path.join(this.root, `${safeId(profileId)}.json`)
  }

  load(profileId) {
    if (this.cache.has(profileId)) return this.cache.get(profileId)
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(this.fileFor(profileId), 'utf8'))
    } catch {
      raw = undefined
    }
    const state = normalizeState(profileId, raw)
    this.cache.set(profileId, state)
    return state
  }

  save(profileId) {
    const state = this.load(profileId)
    state.updatedAt = this.now().toISOString()
    fs.mkdirSync(this.root, { recursive: true })
    const file = this.fileFor(profileId)
    const temp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    fs.renameSync(temp, file)
    return state
  }

  recordToolUse({
    profileId,
    tool,
    capabilityId,
    outcome = 'unknown',
    durationMs,
    sessionId,
    chatKey,
  }) {
    if (typeof tool !== 'string' || tool.length === 0) throw new Error('tool is required')
    const state = this.load(profileId)
    const entry = state.tools[tool] ?? {
      calls: 0,
      successes: 0,
      failures: 0,
      unknown: 0,
      totalDurationMs: 0,
      lastUsedAt: null,
    }
    entry.calls += 1
    entry.lastUsedAt = this.now().toISOString()
    if (outcome === 'success') entry.successes += 1
    else if (outcome === 'failure') entry.failures += 1
    else entry.unknown += 1
    if (Number.isFinite(durationMs) && durationMs >= 0) entry.totalDurationMs += durationMs
    if (capabilityId) entry.capabilityId = capabilityId
    state.tools[tool] = entry
    state.totals.toolCalls += 1
    if (outcome === 'success') state.totals.successes += 1
    else if (outcome === 'failure') state.totals.failures += 1
    if (capabilityId) {
      const cap = state.capabilities[capabilityId] ?? { calls: 0, successes: 0, failures: 0 }
      cap.calls += 1
      if (outcome === 'success') cap.successes += 1
      else if (outcome === 'failure') cap.failures += 1
      state.capabilities[capabilityId] = cap
    }
    if (sessionId) {
      const session = state.sessions[sessionId] ?? {
        calls: 0,
        successes: 0,
        failures: 0,
        chatKey: chatKey ?? null,
        lastUsedAt: null,
      }
      session.calls += 1
      session.lastUsedAt = entry.lastUsedAt
      if (outcome === 'success') session.successes += 1
      else if (outcome === 'failure') session.failures += 1
      state.sessions[sessionId] = session
    }
    return state
  }

  recordTurn({ profileId, tools = [], sessionId, chatKey } = {}) {
    const state = this.load(profileId)
    state.totals.turns += 1
    for (const item of tools) {
      this.recordToolUse({
        profileId,
        tool: item.tool,
        capabilityId: item.capabilityId,
        outcome: item.outcome,
        durationMs: item.durationMs,
        sessionId,
        chatKey,
      })
    }
    return this.save(profileId)
  }

  snapshot(profileId) {
    return structuredClone(this.load(profileId))
  }

  stats() {
    return {
      profiles: this.cache.size,
      files: (() => {
        try {
          return fs.readdirSync(this.root).filter((name) => name.endsWith('.json')).length
        } catch {
          return 0
        }
      })(),
    }
  }
}
