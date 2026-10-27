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

export const LEGACY_CONTRACT = '1.0'
export const SUPPORTED_CONTRACT_MAJOR = 1

// "1", "1.2", "1.2.3", optionally followed by a semver pre-release/build
// suffix such as "-rc.1" or "+build.7".
const CONTRACT_PATTERN = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+][0-9A-Za-z.-]+)?$/

/**
 * Parse a declared platform contract version.
 *
 * Accepts strings and numbers in `major[.minor[.patch]]` form. Returns
 * `undefined` for values that cannot be interpreted as a version, so callers
 * can reject malformed manifests instead of guessing.
 *
 * @param {unknown} value
 * @returns {{ major: number, minor: number, patch: number } | undefined}
 */
export function parseContractVersion(value) {
  const text = typeof value === 'number'
    ? (Number.isFinite(value) && value >= 0 ? String(value) : undefined)
    : typeof value === 'string' ? value.trim() : undefined
  if (text === undefined || text === '') return undefined
  const match = CONTRACT_PATTERN.exec(text)
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
  }
}

function describeValue(value) {
  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return json
  } catch {
    // fall through to String
  }
  return String(value)
}

function sectionsOf(pkg) {
  const dsh = pkg?.dsh && typeof pkg.dsh === 'object' ? pkg.dsh : (pkg ?? {})
  const platform = dsh.platform && typeof dsh.platform === 'object' ? dsh.platform : {}
  return { dsh, platform }
}

/**
 * Validate a package manifest against the platform capability contract.
 *
 * The check is intentionally narrow: it guards the contract version and the
 * identity fields that the registry relies on (profile and capability ids).
 * Anything else is left to the plugin adapter.
 *
 * Rules:
 * - `dsh.platform.contract` missing: accepted as legacy `1.0` with a warning.
 * - contract major 1: accepted (`1`, `1.2`, `1.2.3`, `1.2.3-rc.1`, numbers).
 * - contract major >= 2: rejected.
 * - malformed/unsupported contract: rejected.
 * - `profiles[*]`: needs a non-empty string `id` and `agentPreset`;
 *   duplicate ids are rejected.
 * - `capabilities[*]`: needs a non-empty string `id`; duplicate ids are
 *   rejected.
 *
 * @param {any} pkg package.json object, or the `dsh` object itself.
 * @returns {{
 *   ok: boolean,
 *   contract: string | undefined,
 *   major: number | undefined,
 *   legacy: boolean,
 *   errors: string[],
 *   warnings: string[],
 *   manifest: ReturnType<typeof readPlatformManifest>,
 * }}
 */
export function validatePlatformManifest(pkg = {}) {
  const manifest = readPlatformManifest(pkg)
  const { dsh, platform } = sectionsOf(pkg)
  const errors = []
  const warnings = []

  const declared = platform.contract ?? dsh.pluginApi
  const missing = declared === undefined || declared === null
  let contract
  let major
  let legacy = false

  if (missing) {
    contract = LEGACY_CONTRACT
    major = SUPPORTED_CONTRACT_MAJOR
    legacy = true
    warnings.push('dsh.platform.contract is missing; treating the manifest as legacy contract 1.0')
  } else {
    contract = typeof declared === 'string'
      ? declared.trim()
      : typeof declared === 'number' && Number.isFinite(declared) ? String(declared) : undefined
    const parsed = parseContractVersion(declared)
    if (parsed === undefined) {
      errors.push(`dsh.platform.contract ${describeValue(declared)} is malformed; expected a version such as "1.2"`)
    } else {
      major = parsed.major
      if (parsed.major !== SUPPORTED_CONTRACT_MAJOR) {
        errors.push(parsed.major > SUPPORTED_CONTRACT_MAJOR
          ? `dsh.platform.contract ${describeValue(declared)} uses major ${parsed.major}; this platform implements contract major 1`
          : `dsh.platform.contract ${describeValue(declared)} uses major ${parsed.major}; contract 1.x is required`)
      }
    }
  }

  if (platform.profiles !== undefined && !Array.isArray(platform.profiles)) {
    warnings.push('dsh.platform.profiles is not an array; ignoring it')
  }
  const seenProfiles = new Map()
  manifest.profiles.forEach((entry, index) => {
    const at = `dsh.platform.profiles[${index}]`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at} must be an object with id and agentPreset`)
      return
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (id === '') errors.push(`${at}.id must be a non-empty string`)
    if (typeof entry.agentPreset !== 'string' || entry.agentPreset.trim() === '') {
      errors.push(`${at}.agentPreset must be a non-empty string`)
    }
    if (id !== '') {
      const first = seenProfiles.get(id)
      if (first === undefined) seenProfiles.set(id, index)
      else errors.push(`${at}.id duplicates profile id ${JSON.stringify(id)} from dsh.platform.profiles[${first}]`)
    }
  })

  const legacyCapabilities = !Array.isArray(platform.capabilities) && Array.isArray(dsh.capabilities)
  const capabilitySource = legacyCapabilities ? 'dsh.capabilities' : 'dsh.platform.capabilities'
  if (platform.capabilities !== undefined && !Array.isArray(platform.capabilities)) {
    warnings.push(Array.isArray(dsh.capabilities)
      ? 'dsh.platform.capabilities is not an array; using dsh.capabilities instead'
      : 'dsh.platform.capabilities is not an array; ignoring it')
  } else if (platform.capabilities === undefined && dsh.capabilities !== undefined
    && !Array.isArray(dsh.capabilities)) {
    warnings.push('dsh.capabilities is not an array; ignoring it')
  }

  const seenCapabilities = new Map()
  manifest.capabilities.forEach((entry, index) => {
    const at = `${capabilitySource}[${index}]`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${at} must be an object with an id`)
      return
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (id === '') {
      errors.push(`${at}.id must be a non-empty string`)
      return
    }
    const first = seenCapabilities.get(id)
    if (first === undefined) seenCapabilities.set(id, index)
    else errors.push(`${at}.id duplicates capability id ${JSON.stringify(id)} from ${capabilitySource}[${first}]`)
  })

  return {
    ok: errors.length === 0,
    contract,
    major,
    legacy,
    errors,
    warnings,
    manifest,
  }
}
