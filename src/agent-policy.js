function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.length > 0)
}

/**
 * Only user-facing main agents should receive platform prompt policy.
 * DSH creates compaction, tool and sub-agent agents through the same event.
 */
export function isPrimaryAgent(agent, source) {
  if (!agent) return false
  if (agent.parent || agent.parentAgent) return false
  const meta = agent.session?.meta ?? agent.meta ?? {}
  if (meta.parentSessionId || meta.parentAgentId || meta.subagent === true) return false
  if (typeof source === 'string' && /subagent|child|compact|tool-agent/i.test(source)) return false
  return true
}

/**
 * Resolve the conversation profile attached to an agent. session-core sets
 * `agent.__platformProfile`; the preset is a fallback for agents created by
 * other hosts.
 */
export function profileForAgent(agent, profiles) {
  if (!agent) return undefined
  if (agent.__platformProfile && typeof agent.__platformProfile === 'object') {
    return agent.__platformProfile
  }
  const meta = agent.session?.meta ?? agent.meta ?? {}
  const preset = firstString(meta.agentPreset, agent.agentPreset)
  if (!preset || !profiles?.list) return undefined
  return profiles.list().find((profile) => profile.agentPreset === preset)
}

export function platformPromptAllowed(profile) {
  return profile?.promptPolicy?.platformPrompts !== false
}

export function profileCapabilitiesMode(profile) {
  const value = profile?.promptPolicy?.capabilities
  return value === 'none' || value === 'full' ? value : 'index'
}
