/**
 * Reject unknown capability ids before they reach tool exposure. An unknown id
 * must not silently turn into "deny every managed tool"; if nothing valid
 * remains we drop the restriction and fall back to the unmanaged default.
 */
export function repairProfileCapabilities(profile, capabilities = [], { onUnknown } = {}) {
  if (!profile || !Array.isArray(profile.capabilities)) {
    return { profile, unknown: [], dropped: 0 }
  }
  const known = new Set(
    (Array.isArray(capabilities) ? capabilities : [])
      .map((capability) => capability?.id)
      .filter(Boolean),
  )
  const active = []
  const unknown = []
  for (const id of profile.capabilities) {
    if (known.has(id)) active.push(id)
    else unknown.push(id)
  }
  if (unknown.length === 0) return { profile, unknown, dropped: 0 }
  for (const id of unknown) onUnknown?.(id)
  const repaired = active.length > 0
    ? { ...profile, capabilities: active }
    : { ...profile, capabilities: undefined }
  return { profile: repaired, unknown, dropped: unknown.length }
}
