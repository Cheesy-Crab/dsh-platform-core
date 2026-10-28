/**
 * Expand a predicted profile's active capabilities to its declared families.
 * Explicitly selected profiles stay narrow; only platform defaults get the
 * family envelope, so a prediction cannot hide adjacent tools from the user.
 */
export function expandCapabilityFamilies(profile, capabilities = []) {
  const families = new Set(Array.isArray(profile?.families) ? profile.families : [])
  if (!profile || families.size === 0 || !Array.isArray(profile.capabilities)) return profile
  const active = new Set(profile.capabilities)
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    if (capability?.family && families.has(capability.family)) active.add(capability.id)
  }
  return { ...profile, capabilities: [...active] }
}
