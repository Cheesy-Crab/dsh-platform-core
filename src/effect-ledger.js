import { randomUUID } from 'node:crypto'

const OPERATIONS = new Set(['create', 'bind', 'replace', 'release', 'cleanup-failed'])
const STATES = new Set(['pending', 'active', 'delivered', 'failed', 'released'])

/**
 * Append-only effect ownership ledger.
 *
 * It records who created, replaced or released a runtime resource. It is not a
 * sandbox and it is not an arbitration input; it exists so a Host can explain
 * cleanup and stale-generation behavior.
 */
export class EffectLedger {
  constructor({ generationId = 'generation-unknown', log } = {}) {
    this.generationId = generationId
    this.log = log
    this.records = []
    this.sequence = 0
  }

  record({
    owner = {},
    effectId,
    effectKind,
    operation,
    state = 'active',
    resourceId,
    correlationId,
    sensitivityClass = 'private',
    outcome,
    errorCode,
  } = {}) {
    if (typeof effectId !== 'string' || effectId.length === 0) {
      throw new TypeError('effectId is required')
    }
    if (!OPERATIONS.has(operation)) {
      throw new TypeError(`unknown effect operation: ${String(operation)}`)
    }
    if (!STATES.has(state)) {
      throw new TypeError(`unknown effect state: ${String(state)}`)
    }
    const record = Object.freeze({
      ledgerVersion: '0.1.0',
      recordId: randomUUID(),
      sequence: ++this.sequence,
      recordedAt: new Date().toISOString(),
      generationId: this.generationId,
      owner: {
        pluginId: owner.pluginId ?? 'platform-core',
        ...(owner.activationId ? { activationId: owner.activationId } : {}),
        ...(owner.runtimeId ? { runtimeId: owner.runtimeId } : {}),
      },
      effectId,
      effectKind: effectKind ?? 'unknown',
      operation,
      state,
      ...(resourceId ? { resourceId } : {}),
      ...(correlationId ? { correlationId } : {}),
      sensitivityClass,
      ...(outcome ? { outcome } : {}),
      ...(errorCode ? { errorCode } : {}),
    })
    this.records.push(record)
    return record
  }

  list({ generationId, pluginId, effectId, operation, state } = {}) {
    return this.records.filter((record) => (
      (generationId === undefined || record.generationId === generationId)
      && (pluginId === undefined || record.owner.pluginId === pluginId)
      && (effectId === undefined || record.effectId === effectId)
      && (operation === undefined || record.operation === operation)
      && (state === undefined || record.state === state)
    ))
  }

  stats() {
    const operations = {}
    const states = {}
    for (const record of this.records) {
      operations[record.operation] = (operations[record.operation] ?? 0) + 1
      states[record.state] = (states[record.state] ?? 0) + 1
    }
    return {
      generationId: this.generationId,
      total: this.records.length,
      operations,
      states,
    }
  }
}

export { OPERATIONS as EFFECT_OPERATIONS, STATES as EFFECT_STATES }
