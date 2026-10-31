import { randomUUID } from 'node:crypto'

/**
 * Capability-set signature for generation boundaries.
 *
 * The tool surface is derived from the effective profile's capabilities, so a
 * different set (even for the same profile id) is a new generation.
 *
 * @param {{ capabilities?: string[] } | undefined} profile
 * @returns {string | undefined}
 */
export function capabilitySignature(profile) {
  if (!profile) return undefined
  const list = Array.isArray(profile.capabilities) ? profile.capabilities : []
  return list.length === 0 ? 'none' : [...list].sort().join(',')
}

/**
 * Per-session generation boundary.
 *
 * A generation answers "which assembly of profile + capability set produced
 * this session?". It is not a sandbox and it does not keep objects alive: it
 * only gives delivery and invocation ledgers a stable scope so a request from
 * a retired assembly can be rejected instead of silently replayed.
 *
 * A generation forks when:
 *
 * - the session is seen for the first time;
 * - the effective profile id changes;
 * - the capability set changes.
 *
 * A plain resume of the same assembly reuses the generation, so a turn that
 * continues after a restart does not re-deliver work from before it.
 */
export class GenerationRegistry {
  /**
   * @param {{ log?: (level: string, message: string) => void, prefix?: string }} [options]
   */
  constructor({ log, prefix = 'gen' } = {}) {
    this.log = typeof log === 'function' ? log : undefined
    this.prefix = prefix
    this.bySession = new Map()
    this.sequence = 0
    /** @type {Record<string, number>} fork counts by reason, never pruned */
    this.reasonCounts = {}
  }

  /**
   * Resolve the generation an agent belongs to, forking when the assembly
   * changed. Without a session id this returns `undefined` so the caller can
   * fall back to the process generation.
   *
   * @param {string} [sessionId]
   * @param {{ profileId?: string, capabilitySignature?: string, reason?: string }} [observed]
   * @returns {{ id: string, sessionId: string, reason: string, profileId?: string,
   *   capabilitySignature?: string, startedAt: string } | undefined}
   */
  forSession(sessionId, { profileId, capabilitySignature: signature, reason } = {}) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
    const current = this.bySession.get(sessionId)
    if (!current) {
      return this.fork(sessionId, {
        profileId,
        capabilitySignature: signature,
        reason: reason ?? 'session-created',
      })
    }
    // An observed profile or capability set that differs from the recorded one
    // is a real switch. An incoming `undefined` means "not known yet", so it
    // neither forks nor overwrites what the generation already recorded.
    const profileChanged = profileId !== undefined && profileId !== current.profileId
    const capabilityChanged = signature !== undefined && signature !== current.capabilitySignature
    if (profileChanged || capabilityChanged) {
      return this.fork(sessionId, {
        profileId,
        capabilitySignature: signature,
        reason: profileChanged ? 'profile-switch' : 'capability-switch',
      })
    }
    return current
  }

  /**
   * @param {string} sessionId
   * @param {{ profileId?: string, capabilitySignature?: string, reason?: string }} observed
   */
  fork(sessionId, { profileId, capabilitySignature: signature, reason } = {}) {
    this.sequence += 1
    const generation = {
      id: `${this.prefix}-${Date.now().toString(36)}-${String(this.sequence).padStart(2, '0')}-${randomUUID().slice(0, 6)}`,
      sessionId,
      reason: reason ?? 'manual',
      ...(profileId !== undefined ? { profileId } : {}),
      ...(signature !== undefined ? { capabilitySignature: signature } : {}),
      startedAt: new Date().toISOString(),
    }
    this.bySession.set(sessionId, generation)
    this.reasonCounts[generation.reason] = (this.reasonCounts[generation.reason] ?? 0) + 1
    this.log?.('info', `generation ${generation.id} for ${sessionId} (${generation.reason})`)
    return generation
  }

  /**
   * @param {string} sessionId
   */
  current(sessionId) {
    return this.bySession.get(sessionId)
  }

  /**
   * A request carrying an unknown generation id is accepted (the registry may
   * have been restarted); a request carrying a known-but-retired id is not.
   *
   * @param {string} sessionId
   * @param {string} [generationId]
   */
  isCurrent(sessionId, generationId) {
    if (!generationId) return true
    const current = this.bySession.get(sessionId)
    if (!current) return true
    return current.id === generationId
  }

  /**
   * Explain why a generation was rejected, or `undefined` when it is current.
   *
   * @param {string} sessionId
   * @param {string} [generationId]
   */
  staleReason(sessionId, generationId) {
    if (this.isCurrent(sessionId, generationId)) return undefined
    return { requested: generationId, current: this.bySession.get(sessionId)?.id }
  }

  stats() {
    return {
      sessions: this.bySession.size,
      forked: this.sequence,
      byReason: { ...this.reasonCounts },
    }
  }
}
