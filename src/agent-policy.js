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
 * Resolve an explicitly selected profile for an agent. session-core puts the
 * selected profile id in session meta; platform must not guess by preset.
 */
export function profileForAgent(agent, profiles) {
  if (!agent) return undefined
  if (agent.__platformProfile && typeof agent.__platformProfile === 'object') {
    return agent.__platformProfile
  }
  const meta = agent.session?.meta ?? agent.meta ?? {}
  const profileId = firstString(meta.profileId, agent.profileId)
  if (!profileId || !profiles?.get) return undefined
  return profiles.get(profileId)
}

/**
 * Decide the effective profile exactly once at agent/created.
 *
 * - explicit selection wins;
 * - otherwise ask the registered predictor (user stats) for a default;
 * - otherwise no profile.
 *
 * The result is the single source for prompt and tool exposure.
 */
export function effectiveProfileForAgent(agent, profiles, { predictor } = {}) {
  const selected = profileForAgent(agent, profiles)
  if (selected) return { profile: selected, source: 'selected' }
  const predicted = predictor?.predict?.({ agent, profiles: profiles?.list?.() ?? [] })
  if (predicted) {
    const profile = typeof predicted === 'string' ? profiles?.get?.(predicted) : predicted
    if (profile) return { profile, source: 'predicted' }
  }
  return { profile: undefined, source: 'default' }
}

export function platformPromptAllowed(profile) {
  return profile?.promptPolicy?.platformPrompts !== false
}

export function profileCapabilitiesMode(profile) {
  const value = profile?.promptPolicy?.capabilities
  return value === 'none' || value === 'full' ? value : 'index'
}
