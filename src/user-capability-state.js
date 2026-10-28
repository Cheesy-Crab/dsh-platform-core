import fs from 'node:fs'
import path from 'node:path'

const SCHEMA_VERSION = 1

function safeId(value) {
  const text = String(value ?? '')
  const cleaned = text.replace(/[^A-Za-z0-9._-]/g, '_')
  return cleaned.length > 0 ? cleaned : 'unknown'
}

function empty(userId) {
  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    userId,
    createdAt: now,
    updatedAt: now,
    capabilities: {},
    profiles: {},
    totals: { calls: 0, successes: 0, failures: 0, turns: 0 },
  }
}

function normalize(userId, raw) {
  const state = empty(userId)
  if (!raw || typeof raw !== 'object') return state
  return {
    ...state,
    ...raw,
    userId,
    capabilities: raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities : {},
    profiles: raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : {},
    totals: { ...state.totals, ...(raw.totals && typeof raw.totals === 'object' ? raw.totals : {}) },
  }
}

/**
 * Per-user capability usage. Counts only; no prompts, arguments, results or
 * file paths. This is the input for the default-profile predictor.
 */
export class UserCapabilityStore {
  constructor({ root, now = () => new Date() } = {}) {
    this.root = root
    this.now = now
    this.cache = new Map()
  }

  fileFor(userId) {
    return path.join(this.root, `${safeId(userId)}.json`)
  }

  load(userId) {
    if (this.cache.has(userId)) return this.cache.get(userId)
    let raw
    try {
      raw = JSON.parse(fs.readFileSync(this.fileFor(userId), 'utf8'))
    } catch {
      raw = undefined
    }
    const state = normalize(userId, raw)
    this.cache.set(userId, state)
    return state
  }

  save(userId) {
    const state = this.load(userId)
    state.updatedAt = this.now().toISOString()
    fs.mkdirSync(this.root, { recursive: true })
    const file = this.fileFor(userId)
    const temp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    fs.renameSync(temp, file)
    return state
  }

  recordTurn({ userId, tools = [], profileId, sessionId } = {}) {
    const state = this.load(userId)
    state.totals.turns += 1
    if (profileId) {
      const profile = state.profiles[profileId] ?? { turns: 0, lastUsedAt: null }
      profile.turns += 1
      profile.lastUsedAt = this.now().toISOString()
      state.profiles[profileId] = profile
    }
    for (const item of Array.isArray(tools) ? tools : []) {
      if (!item.capabilityId) continue
      state.totals.calls += 1
      if (item.outcome === 'success') state.totals.successes += 1
      else if (item.outcome === 'failure') state.totals.failures += 1
      const capability = state.capabilities[item.capabilityId] ?? {
        calls: 0,
        successes: 0,
        failures: 0,
        lastUsedAt: null,
      }
      capability.calls += 1
      capability.lastUsedAt = this.now().toISOString()
      if (item.outcome === 'success') capability.successes += 1
      else if (item.outcome === 'failure') capability.failures += 1
      state.capabilities[item.capabilityId] = capability
    }
    return this.save(userId)
  }

  topCapabilities(userId, { limit = 5 } = {}) {
    const state = this.load(userId)
    return Object.entries(state.capabilities)
      .map(([id, stats]) => ({ id, ...stats }))
      .sort((left, right) => (
        right.calls - left.calls
        || String(right.lastUsedAt).localeCompare(String(left.lastUsedAt))
        || left.id.localeCompare(right.id)
      ))
      .slice(0, Math.max(0, limit))
  }

  stats() {
    return { users: this.cache.size }
  }
}
