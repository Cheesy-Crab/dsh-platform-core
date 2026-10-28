/**
 * Predict a capability profile from per-user tool usage. This is a default,
 * never a selection: the result is validated at agent/created and is not
 * written to state.profileId.
 */
export function createProfilePredictor({
  profiles,
  userState,
  capabilities = [],
  minCalls = 3,
  limit = 20,
} = {}) {
  const familyOf = new Map()
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    if (capability?.id && capability.family) familyOf.set(capability.id, capability.family)
  }

  return {
    predict({ agent } = {}) {
      const meta = agent?.session?.meta ?? {}
      const principal = String(meta.principal ?? '')
      const userId = /^(qq-)?group:/.test(principal)
        ? principal
        : (meta.requester ?? meta.principal)
      if (!userId || !userState?.topCapabilities) return undefined
      const top = userState.topCapabilities(userId, { limit })
      const total = top.reduce((sum, item) => sum + item.calls, 0)
      if (total < minCalls) return undefined
      const agentPreset = meta.agentPreset
      const candidates = []
      for (const profile of profiles?.list?.() ?? []) {
        if (agentPreset && profile.agentPreset && profile.agentPreset !== agentPreset) continue
        const active = new Set(Array.isArray(profile.capabilities) ? profile.capabilities : [])
        const families = new Set(Array.isArray(profile.families) ? profile.families : [])
        let score = 0
        for (const item of top) {
          if (active.has(item.id)) score += item.calls
          else if (families.size > 0 && families.has(familyOf.get(item.id))) score += item.calls
        }
        if (score > 0) candidates.push({ profile, score })
      }
      candidates.sort((left, right) => right.score - left.score || left.profile.id.localeCompare(right.profile.id))
      return candidates[0]?.profile
    },
  }
}
