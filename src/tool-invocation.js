function turnIdFor(exec) {
  const turn = exec?.agent?.session?.snapshotEvents?.()
    ?.findLast((event) => event?.type === 'tool/call' && event?.data?.callId === exec.callId)
    ?.data?.turn
  return turn === undefined ? String(exec?.callId ?? 'unknown') : `turn-${turn}`
}

/**
 * Wrap managed tool execution with InvocationLedger.
 *
 * - same session/turn/tool/args runs once;
 * - a concurrent duplicate joins the owner;
 * - a completed duplicate reuses its result;
 * - failures release the claim so a retry can run.
 */
export function createToolInvocationHandler({ invocationLedger, toolCapabilities = new Map(), log } = {}) {
  return async function toolInvocationHandler(exec, next) {
    const tool = exec?.name
    if (!invocationLedger || !tool || !toolCapabilities.has(tool)) return next()
    const session = exec.agent?.session
    const sessionId = session?.header?.id
    if (!sessionId) return next()
    const claim = invocationLedger.claim({
      sessionId,
      turnId: turnIdFor(exec),
      tool,
      args: exec.arguments,
      capabilityId: toolCapabilities.get(tool),
      exclusive: false,
    })

    if (claim.ok === true) {
      const settled = await claim.run(() => next())
      if (settled.ok === true) return settled.result
      throw settled.error ?? new Error(`tool invocation failed: ${tool}`)
    }
    if (claim.reason === 'already_completed') return claim.result
    if (claim.reason === 'in_flight') {
      const settled = await claim.promise
      if (settled.ok === true) return settled.result
      throw settled.error ?? new Error(`tool invocation failed: ${tool}`)
    }
    log?.('warn', `tool invocation rejected: ${tool} (${claim.reason})`)
    throw new Error(`tool invocation rejected: ${tool} (${claim.reason})`)
  }
}
