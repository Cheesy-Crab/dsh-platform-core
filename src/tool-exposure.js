/**
 * Capability-aware tool exposure.
 *
 * DSH exposes tools to an agent through `agent.ctx.tools`. `restrict({ deny })`
 * is an agent-scoped allow/deny mask: hidden tools lose their schema and can no
 * longer be called. We deny only the bound tools of inactive capabilities, so
 * base tools (read/write/exec/...) remain untouched.
 */
function toolNameOf(capability) {
  const name = capability?.bind?.tool
  return typeof name === 'string' && name.length > 0 ? name : undefined
}

export function capabilityToolMap(capabilities = []) {
  const map = new Map()
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const tool = toolNameOf(capability)
    if (!tool) continue
    if (!map.has(capability.id)) map.set(capability.id, tool)
  }
  return map
}

export function visibleToolNames(agent) {
  try {
    const schemas = agent?.ctx?.tools?.schemas?.(agent.ctx)
    if (!Array.isArray(schemas)) return undefined
    return new Set(schemas.map((schema) => schema?.name).filter(Boolean))
  } catch {
    return undefined
  }
}

export const knownToolNames = visibleToolNames

/**
 * Apply a deny mask for managed tools whose capability is not active.
 *
 * `profile.capabilities` is an allowlist of capability IDs. When it is absent
 * (legacy profiles), no restriction is applied. When it is present, every
 * managed tool not bound to an active capability is denied.
 *
 * @returns {(() => void) | undefined} the restriction disposer, if one was made
 */
export function applyToolExposure(agent, { capabilities = [], profile, onError } = {}) {
  const active = Array.isArray(profile?.capabilities) ? new Set(profile.capabilities) : undefined
  if (!active) return undefined
  const managed = capabilityToolMap(capabilities)
  if (managed.size === 0) return undefined
  const known = visibleToolNames(agent)
  if (!known) {
    onError?.(new Error('tool schemas are unavailable; refusing to guess deny list'), { profile })
    return undefined
  }
  const deny = []
  for (const [capabilityId, tool] of managed) {
    if (active.has(capabilityId)) continue
    if (!known.has(tool)) continue
    deny.push(tool)
  }
  if (deny.length === 0) return undefined
  try {
    return agent.ctx.tools.restrict({ deny })
  } catch (error) {
    onError?.(error, { profile, deny, known: [...known] })
    return undefined
  }
}
