import { createHash } from 'node:crypto'

/**
 * Resolve the stable identity of an output.
 *
 * `output.id` wins when it is a non-empty string. Otherwise the identity is
 * derived from the output's path metadata:
 *
 * - `path` with neither `size` nor `mtime` is used as-is (fallback);
 * - `path` plus `size` and/or `mtime` becomes `sha256:<hex>`, so the same file
 *   descriptor maps to the same id across coordinator instances.
 *
 * The file is never read from disk: only metadata already present on the
 * output object is used.
 *
 * @param {object} output
 * @returns {string}
 * @throws {TypeError} when the output has neither a non-empty `id` nor `path`
 */
export function outputIdOf(output) {
  if (output === null || typeof output !== 'object') {
    throw new TypeError('output must be an object')
  }
  if (typeof output.id === 'string' && output.id.length > 0) return output.id
  if (typeof output.path === 'string' && output.path.length > 0) {
    const hasSize = output.size !== undefined && output.size !== null
    const hasMtime = output.mtime !== undefined && output.mtime !== null
    if (!hasSize && !hasMtime) return output.path
    const parts = [output.path]
    if (hasSize) parts.push(`size:${String(output.size)}`)
    if (hasMtime) {
      const mtime = output.mtime instanceof Date ? output.mtime.getTime() : output.mtime
      parts.push(`mtime:${String(mtime)}`)
    }
    const digest = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
    return `sha256:${digest}`
  }
  throw new TypeError('output requires a non-empty "id" or "path"')
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function normalizeId(value) {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/**
 * @param {((level: string, message: string) => void) | undefined} log
 * @param {string} level
 * @param {string} message
 */
function logSafely(log, level, message) {
  try {
    log?.(level, message)
  } catch {
    // Logging must never break delivery state transitions.
  }
}

/**
 * Deduplicating delivery coordinator.
 *
 * A delivery is identified by `${sessionId}|${turnId}|${surface}|${outputId}`.
 * The key intentionally excludes `target`: one output is delivered at most
 * once per turn and surface, even if the same coordinator is asked to send it
 * to several targets.
 *
 * Lifecycle:
 *
 * 1. The first `deliver()` for a key claims it and calls `send`.
 * 2. Concurrent `deliver()` calls for that key wait on the same in-flight
 *    promise, so `send` runs exactly once and every caller receives the same
 *    result object.
 * 3. A successful send commits the key; later calls return
 *    `{ skipped: 'already_delivered' }` without calling `send`.
 * 4. A failed send releases the claim and rejects every waiting caller with
 *    the original error. The failure is recorded for `status()`, but it does
 *    not block a retry: the next `deliver()` calls `send` again.
 *
 * The coordinator is surface-neutral, imports only Node.js standard library
 * modules and never reads output files.
 */
export class DeliveryCoordinator {
  /**
   * @param {{ log?: (level: string, message: string) => void }} [options]
   */
  constructor({ log } = {}) {
    this.log = log
    /**
     * Delivery records by key. A `pending` record owns the in-flight promise;
     * `failed` records are retryable tombstones kept so status can report them.
     * @type {Map<string, {
     *   state: 'pending' | 'delivered' | 'failed',
     *   outputId: string,
     *   promise?: Promise<object>,
     *   error?: unknown,
     * }>}
     */
    this.deliveries = new Map()
  }

  /**
   * Deliver one output at most once for a turn and surface.
   *
   * `send` is always invoked as `send(output, target)`.
   *
   * @param {object} input
   * @param {string | number} input.sessionId
   * @param {string | number} input.turnId
   * @param {string} input.surface
   * @param {unknown} [input.target] forwarded to `send` unchanged
   * @param {object} input.output
   * @param {(output: object, target: unknown) => unknown | Promise<unknown>} input.send
   * @returns {Promise<
   *   | { delivered: true, key: string, outputId: string, result: unknown }
   *   | { skipped: 'already_delivered', key: string, outputId: string }
   * >} the caller's send result is returned as `result` on the first delivery;
   *   concurrent callers receive the same object. Duplicate deliveries return
   *   the skip marker without calling `send`.
   * @throws {TypeError} rejects when required identifiers are missing, `send`
   *   is not a function, or the output has no non-empty `id` / `path`.
   */
  async deliver({ sessionId, turnId, surface, target, output, send } = {}) {
    const sid = normalizeId(sessionId)
    const tid = normalizeId(turnId)
    const srf = normalizeId(surface)
    if (!sid) throw new TypeError('sessionId is required')
    if (!tid) throw new TypeError('turnId is required')
    if (!srf) throw new TypeError('surface is required')
    if (typeof send !== 'function') throw new TypeError('send must be a function')
    const outputId = outputIdOf(output)
    const key = [sid, tid, srf, outputId].join('|')

    const existing = this.deliveries.get(key)
    if (existing?.state === 'delivered') {
      return { skipped: 'already_delivered', key, outputId }
    }
    if (existing?.state === 'pending' && existing.promise) {
      return existing.promise
    }

    // Claim the key before yielding so concurrent callers cannot race. A
    // failed record is deliberately overwritten here: failures are retryable.
    const record = { state: 'pending', outputId }
    this.deliveries.set(key, record)

    const promise = Promise.resolve().then(async () => {
      try {
        const result = await send(output, target)
        record.state = 'delivered'
        record.promise = undefined
        logSafely(this.log, 'info', `delivered ${key}`)
        return { delivered: true, key, outputId, result }
      } catch (error) {
        record.state = 'failed'
        record.error = error
        record.promise = undefined
        logSafely(this.log, 'warn', `delivery failed for ${key}: ${error?.message ?? error}`)
        throw error
      }
    })
    record.promise = promise
    return promise
  }

  /**
   * Look up the delivery state for one key.
   *
   * `outputId` must be the id used by `deliver()`: either `output.id`, the
   * path fallback, or the value returned in `deliver()`'s result. For
   * outputs with path metadata, use `outputIdOf(output)` to compute it.
   *
   * @param {object} [query]
   * @param {string | number} [query.sessionId]
   * @param {string | number} [query.turnId]
   * @param {string} [query.surface]
   * @param {string} [query.outputId]
   * @returns {{
   *   state: 'delivered' | 'failed' | 'pending' | 'unknown',
   *   key: string | null,
   *   outputId: string | null,
   *   error?: unknown,
   * }} `delivered` means committed; `pending` means one send is in flight;
   *   `failed` means the last attempt failed and a retry is allowed (error is
   *   included); `unknown` means no attempt is recorded, or an identifier is
   *   missing (then `key` is null).
   */
  status({ sessionId, turnId, surface, outputId } = {}) {
    const sid = normalizeId(sessionId)
    const tid = normalizeId(turnId)
    const srf = normalizeId(surface)
    const oid = normalizeId(outputId)
    if (!sid || !tid || !srf || !oid) {
      return { state: 'unknown', key: null, outputId: oid ?? null }
    }
    const key = [sid, tid, srf, oid].join('|')
    const record = this.deliveries.get(key)
    if (!record) return { state: 'unknown', key, outputId: oid }
    if (record.state === 'delivered') return { state: 'delivered', key, outputId: oid }
    if (record.state === 'failed') return { state: 'failed', key, outputId: oid, error: record.error }
    return { state: 'pending', key, outputId: oid }
  }
}
