/**
 * Collect tool usage metadata from a session event slice. Only names and
 * outcomes are retained; arguments, results and message text are discarded.
 */
export function collectToolUsage(events = [], { toolCapability = new Map() } = {}) {
  const calls = new Map()
  const results = new Map()
  for (const event of Array.isArray(events) ? events : []) {
    const type = event?.type
    const data = event?.data ?? {}
    if (type === 'tool/call') {
      const callId = data.callId ?? data.id ?? data.message?.toolCallId
      const name = data.name ?? data.message?.name
      if (typeof name === 'string' && name.length > 0) {
        calls.set(callId ?? `${event.seq}:${name}`, { tool: name, capabilityId: toolCapability.get(name) })
      }
      continue
    }
    if (type === 'tool/result') {
      const message = data.message ?? {}
      const callId = data.callId ?? message.toolCallId
      const text = Array.isArray(message.content)
        ? message.content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n')
        : ''
      const failed = message.isError === true
        || Boolean(data.error)
        || /^(error|tool error|执行失败|工具失败)[:：]/i.test(text.trim())
      results.set(callId, failed ? 'failure' : 'success')
    }
  }
  return [...calls.entries()].map(([callId, call]) => ({
    tool: call.tool,
    ...(call.capabilityId ? { capabilityId: call.capabilityId } : {}),
    outcome: results.get(callId) ?? 'unknown',
  }))
}

export function toolCapabilityMap(capabilities = []) {
  const map = new Map()
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const tool = capability?.bind?.tool
    if (typeof tool === 'string' && tool.length > 0 && !map.has(tool)) {
      map.set(tool, capability.id)
    }
  }
  return map
}
