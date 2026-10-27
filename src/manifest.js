/**
 * Read a plugin's DSH metadata without assuming a single vendor format.
 *
 * DSH-owned fields (`bundle`, `client`, `engines`, `peerDependencies`) stay
 * untouched. Our contract lives under `dsh.platform`; the pre-1.2 fields are
 * still read so existing plugins keep working.
 */
export function readPlatformManifest(pkg = {}) {
  const dsh = pkg?.dsh && typeof pkg.dsh === 'object' ? pkg.dsh : (pkg ?? {})
  const platform = dsh.platform && typeof dsh.platform === 'object' ? dsh.platform : {}
  const capabilities = Array.isArray(platform.capabilities)
    ? platform.capabilities
    : Array.isArray(dsh.capabilities) ? dsh.capabilities : []
  const profiles = Array.isArray(platform.profiles) ? platform.profiles : []
  const prompts = Array.isArray(platform.prompts)
    ? platform.prompts
    : Array.isArray(dsh.prompts) ? dsh.prompts : []
  const skills = Array.isArray(platform.skills)
    ? platform.skills
    : Array.isArray(dsh.skills) ? dsh.skills : []
  const tools = Array.isArray(platform.tools)
    ? platform.tools
    : Array.isArray(dsh.tools) ? dsh.tools : []

  const roles = new Set(Array.isArray(platform.roles) ? platform.roles : [])
  if (capabilities.length > 0) roles.add('capability')
  if (profiles.length > 0) roles.add('profile')
  if (dsh.client) roles.add('client')
  if (dsh.bundle) roles.add('bundle')
  if (platform.adapter) roles.add('adapter')

  return {
    contract: platform.contract ?? dsh.pluginApi ?? '1.0',
    capabilities,
    profiles,
    prompts,
    skills,
    tools,
    roles: [...roles],
    client: dsh.client,
    bundle: dsh.bundle,
  }
}

export function inferRoles(manifest) {
  return readPlatformManifest(manifest).roles
}
