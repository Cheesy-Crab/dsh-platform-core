import { capabilityToolMap } from './tool-exposure.js'

/**
 * Execution-side guard for capability-bound tools. `tools.restrict` hides
 * global schemas; a preset-scope tool can remain visible, so the guard closes
 * that gap by denying calls to tools whose capability is inactive.
 */
export function applyToolGuard(agent, { capabilities = [], profile, onError } = {}) {
  if (!Array.isArray(profile?.capabilities)) return undefined
  const active = new Set(profile.capabilities)
  const denied = new Set()
  for (const [capabilityId, tool] of capabilityToolMap(capabilities)) {
    if (!active.has(capabilityId)) denied.add(tool)
  }
  if (denied.size === 0) return undefined
  try {
    return agent.ctx.tools.guard((exec) => {
      const name = exec?.toolName ?? exec?.tool?.name ?? exec?.name
      return denied.has(name)
        ? `profile ${profile.id ?? ''} does not allow tool: ${name}`
        : undefined
    })
  } catch (error) {
    onError?.(error, { profile, denied: [...denied] })
    return undefined
  }
}
