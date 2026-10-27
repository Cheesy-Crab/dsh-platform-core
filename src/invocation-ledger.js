import { createHash, randomUUID } from 'node:crypto'

const CIRCULAR = '[circular]'
const UNKNOWN = '[unserializable]'

function isObject(value) {
  return typeof value === 'object' && value !== null
}

function cloneStable(value, stack) {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) ? value : String(value)
  if (type === 'undefined') return null
  if (type === 'bigint') return String(value)
  if (type === 'function' || type === 'symbol') return String(value)
  if (type !== 'object') return String(value)
  if (stack.has(value)) return CIRCULAR
  stack.add(value)
  let stable
  if (Array.isArray(value)) {
    stable = value.map((item) => cloneStable(item, stack))
  } else if (value instanceof Date) {
    stable = Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString()
  } else {
    stable = {}
    for (const key of Object.keys(value).sort()) stable[key] = cloneStable(value[key], stack)
  }
  stack.delete(value)
  return stable
}

/**
 * Stable JSON for invocation arguments: object keys are sorted recursively,
 * array order is preserved, and null/undefined/primitives are normalized.
 * If an argument is too exotic to serialize (throwing getters, proxies), fall
 * back to `String(value)` so hashing never throws and cannot break a claim.
 */
function normalizeArgs(args) {
  try {
    return JSON.stringify(cloneStable(args, new Set()))
  } catch {
    try {
      return JSON.stringify(String(args))
    } catch {
      return JSON.stringify(UNKNOWN)
    }
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function requireId(name, value) {
  if (value === undefined || value === null || String(value) === '') {
    throw new TypeError(`InvocationLedger.claim requires a non-empty ${name}`)
  }
  return String(value)
}

function requireKey(method, key) {
  if (typeof key !== 'string' || key === '') {
    throw new TypeError(`InvocationLedger.${method} requires a non-empty key`)
  }
}

function regenerateRequested(args) {
  return isObject(args) && !Array.isArray(args) && args.regenerate === true
}

function writeLog(log, level, message) {
  try {
    log?.(level, message)
  } catch {
    // diagnostics must never break invocation bookkeeping
  }
}

/**
 * InvocationLedger — deduplicate and single-flight tool invocations.
 *
 * The ledger answers one question — "has this exact invocation already been
 * attempted, and is it running right now?" — with two independent guards:
 *
 * 1. **Argument dedupe.** A claim is identified by
 *    `<sessionId>|<turnId>|<tool>|<sha256(normalizedArgs)>`. Completed claims
 *    replay their cached result instead of executing again. While a claim is
 *    in flight, later claims join it instead of starting a second execution.
 * 2. **Capability exclusivity** (opt-in with `exclusive: true`). The claim also
 *    takes the mutex `<sessionId>|<turnId>|capability:<capabilityId>`, so only
 *    one invocation may succeed for that capability in that turn. A failed
 *    execution releases the mutex; a successful one keeps its result and
 *    reports it to later claims for the same capability and turn. The mutex is
 *    scoped to the turn only — a later turn may run the capability again. Only
 *    claims flagged `exclusive: true` participate, so a caller must use the
 *    flag consistently for a capability to be protected.
 *
 * ## Claim results
 *
 * - `{ ok: true, key, owner: true, exclusive, capabilityKey, run }` — this
 *   caller owns the invocation. `run(fn)` executes `fn` (repeated calls return
 *   the same promise), caches the result with `complete(key, result)`, and
 *   resolves to `{ ok: true, key, result }`. If `fn` throws, `fail(key, error)`
 *   is called and `run` rethrows the original error.
 * - `{ ok: false, reason: 'in_flight', key, promise }` — another claim with the
 *   same key is running. `promise` resolves to the same settlement outcome as
 *   the owner (`{ ok: true, key, result }` or
 *   `{ ok: false, reason: 'failed', key, error }`) and never rejects, so
 *   joining a doomed invocation cannot produce an unhandled rejection.
 * - `{ ok: false, reason: 'already_completed', key, result }` — the cached
 *   result of this key, or of its capability when exclusivity already
 *   completed for this turn.
 * - `{ ok: false, reason: 'exclusive_busy', key, capabilityKey, heldKey }` —
 *   another invocation holds the exclusive capability for this turn.
 *
 * ## Argument normalization
 *
 * Object keys are sorted at every depth, arrays preserve order, and
 * `null`/`undefined` normalize to `null`. Finite numbers stay numbers; bigint,
 * symbol, function, `NaN` and `Infinity` become strings; dates become ISO
 * strings; cycles become `[circular]`. If serialization still fails, the
 * fallback is `String(args)`. `sessionId`, `turnId` and `tool` are coerced to
 * strings and must be non-empty.
 *
 * ## `args.regenerate === true`
 *
 * A top-level, strictly boolean `regenerate: true` flags an explicit re-run:
 *
 * - It never matches a completed claim — every regenerate claim executes again,
 *   even if an identical regenerate claim already completed. The flag is part
 *   of the normalized args, so a regenerate key never collides with the plain
 *   key for the same request.
 * - In-flight single-flight still applies: concurrent identical regenerate
 *   claims share one execution.
 * - Exclusivity is not bypassed: a regenerate for a capability that is already
 *   running returns `exclusive_busy`, and one for a capability that already
 *   succeeded this turn returns `already_completed`. Regenerate is only useful
 *   with `exclusive` when the previous execution failed.
 *
 * ## Side effects
 *
 * The ledger has no effect metadata and does not guess which tools have side
 * effects. Callers decide when to use dedupe, exclusivity, or neither; the only
 * policy inputs are `exclusive` and `args.regenerate`.
 *
 * ## Lifetime
 *
 * Entries live as long as the ledger so `status` and dedupe can answer for
 * finished claims; there is no TTL or pruning. Create one ledger per session
 * (keys are already scoped by turn) and discard it when the session ends, or
 * create one per turn when only turn-scoped memory is wanted.
 */
export class InvocationLedger {
  constructor({ log } = {}) {
    this.log = typeof log === 'function' ? log : undefined
    /** @type {Map<string, object>} key -> invocation entry */
    this.entries = new Map()
    /** @type {Map<string, object>} capability key -> mutex entry */
    this.capabilities = new Map()
  }

  /**
   * Claim an invocation.
   *
   * @param {object} input
   * @param {string} input.sessionId
   * @param {string} input.turnId
   * @param {string} input.tool
   * @param {*} [input.args] arguments hashed for dedupe
   * @param {string} [input.capabilityId] exclusive capability identity; falls
   *   back to `tool` when omitted
   * @param {boolean} [input.exclusive] take the per-turn capability mutex
   * @returns {object} one of the documented claim results
   */
  claim({ sessionId, turnId, tool, args, capabilityId, exclusive } = {}) {
    const session = requireId('sessionId', sessionId)
    const turn = requireId('turnId', turnId)
    const toolName = requireId('tool', tool)
    const key = `${session}|${turn}|${toolName}|${sha256(normalizeArgs(args))}`
    const regenerate = regenerateRequested(args)
    const exclusiveMode = Boolean(exclusive)

    const current = this.entries.get(key)
    if (current?.state === 'in_flight') {
      writeLog(this.log, 'debug', `invocation in flight, joining: ${toolName} ${key}`)
      return { ok: false, reason: 'in_flight', key, promise: current.promise }
    }
    if (current?.state === 'completed' && !regenerate) {
      writeLog(this.log, 'debug', `invocation already completed: ${toolName} ${key}`)
      return { ok: false, reason: 'already_completed', key, result: current.result }
    }

    let capabilityKey
    if (exclusiveMode) {
      const capability = capabilityId === undefined || capabilityId === null || capabilityId === ''
        ? toolName
        : String(capabilityId)
      capabilityKey = `${session}|${turn}|capability:${capability}`
      const held = this.capabilities.get(capabilityKey)
      if (held?.state === 'in_flight') {
        writeLog(this.log, 'debug', `exclusive capability busy: ${capabilityKey}`)
        return { ok: false, reason: 'exclusive_busy', key, capabilityKey, heldKey: held.key }
      }
      if (held?.state === 'completed') {
        writeLog(this.log, 'debug', `exclusive capability already completed: ${capabilityKey}`)
        return { ok: false, reason: 'already_completed', key, capabilityKey, result: held.result }
      }
    }

    const ledger = this
    const claimId = randomUUID()
    let settle
    const promise = new Promise((resolve) => { settle = resolve })
    const entry = {
      key,
      state: 'in_flight',
      claimId,
      result: undefined,
      error: undefined,
      capabilityKey,
      promise,
      settle,
    }
    this.entries.set(key, entry)
    if (capabilityKey) {
      this.capabilities.set(capabilityKey, { state: 'in_flight', key, claimId, result: undefined })
    }
    writeLog(this.log, 'debug', `invocation claimed: ${toolName} ${key}`)

    let execution
    return {
      ok: true,
      key,
      owner: true,
      exclusive: exclusiveMode,
      capabilityKey,
      run: (fn) => {
        if (typeof fn !== 'function') throw new TypeError('claim.run(fn) requires a function')
        execution ??= (async () => {
          if (entry.state === 'completed') return { ok: true, key, result: entry.result }
          if (entry.state === 'failed') return { ok: false, reason: 'failed', key, error: entry.error }
          if (entry.state !== 'in_flight' || entry.claimId !== claimId) {
            return { ok: false, reason: 'not_owner', key }
          }
          try {
            return ledger.complete(key, await fn())
          } catch (error) {
            ledger.fail(key, error)
            throw error
          }
        })()
        return execution
      },
    }
  }

  /**
   * Record a successful settlement and resolve anyone joining this key.
   * Settlement is first-wins: settling an already settled key leaves its
   * outcome untouched (a completed invocation is never retroactively failed,
   * and a failed one is not retroactively completed). Completing a key that
   * was never claimed seeds a completed entry so later claims dedupe.
   *
   * @returns {{ ok: true, key: string, result: * } | { ok: false, reason: 'failed', key: string, error: * }}
   */
  complete(key, result) {
    requireKey('complete', key)
    const entry = this.entries.get(key)
    if (!entry) {
      this.entries.set(key, { key, state: 'completed', result })
      writeLog(this.log, 'debug', `invocation completed without claim: ${key}`)
      return { ok: true, key, result }
    }
    if (entry.state === 'completed') return { ok: true, key, result: entry.result }
    if (entry.state === 'failed') return { ok: false, reason: 'failed', key, error: entry.error }

    entry.state = 'completed'
    entry.result = result
    entry.error = undefined
    const outcome = { ok: true, key, result }
    const { capabilityKey, claimId } = entry
    if (capabilityKey && this.capabilities.get(capabilityKey)?.claimId === claimId) {
      this.capabilities.set(capabilityKey, { state: 'completed', key, claimId, result })
    }
    entry.settle?.(outcome)
    entry.settle = undefined
    writeLog(this.log, 'debug', `invocation completed: ${key}`)
    return outcome
  }

  /**
   * Record a failed settlement: joiners receive
   * `{ ok: false, reason: 'failed', key, error }`, the capability mutex is
   * released, and the key becomes claimable again so the caller can retry.
   * Settlement is first-wins, like `complete`.
   *
   * @returns {{ ok: false, reason: 'failed', key: string, error: * } | { ok: true, key: string, result: * }}
   */
  fail(key, error) {
    requireKey('fail', key)
    const entry = this.entries.get(key)
    if (!entry) {
      this.entries.set(key, { key, state: 'failed', error })
      writeLog(this.log, 'warn', `invocation failed without claim: ${key}`)
      return { ok: false, reason: 'failed', key, error }
    }
    if (entry.state === 'completed') return { ok: true, key, result: entry.result }
    if (entry.state === 'failed') return { ok: false, reason: 'failed', key, error: entry.error }

    entry.state = 'failed'
    entry.error = error
    entry.result = undefined
    const outcome = { ok: false, reason: 'failed', key, error }
    const { capabilityKey, claimId } = entry
    if (capabilityKey && this.capabilities.get(capabilityKey)?.claimId === claimId) {
      this.capabilities.delete(capabilityKey)
    }
    entry.settle?.(outcome)
    entry.settle = undefined
    writeLog(this.log, 'warn', `invocation failed: ${key} ${error?.message ?? error}`)
    return outcome
  }

  /**
   * Inspect a key without changing it.
   *
   * @returns {{ key: string, state: 'unknown' }
   *   | { key: string, state: 'in_flight', capabilityKey?: string }
   *   | { key: string, state: 'completed', result: *, capabilityKey?: string }
   *   | { key: string, state: 'failed', error: *, capabilityKey?: string }}
   */
  status(key) {
    requireKey('status', key)
    const entry = this.entries.get(key)
    if (!entry) return { key, state: 'unknown' }
    const status = { key, state: entry.state }
    if (entry.capabilityKey) status.capabilityKey = entry.capabilityKey
    if (entry.state === 'completed') status.result = entry.result
    if (entry.state === 'failed') status.error = entry.error
    return status
  }
}
