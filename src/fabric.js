/**
 * Fabric-shaped compatibility helpers.
 *
 * This module does not claim DSH Community Fabric conformance. Fabric is a
 * draft (RFC 0001-0004), so the platform exposes a small, explicit adapter:
 * a host descriptor, required/optional capability negotiation, and a
 * best-effort manifest projection with unmapped fields reported instead of
 * guessed.
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

function parseVersion(value) {
  if (typeof value !== 'string') return undefined
  const match = SEMVER.exec(value.trim())
  if (!match) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4],
  }
}

function compare(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return 0
}

function comparatorSatisfied(version, comparator) {
  const match = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(comparator.trim())
  if (!match) return false
  const op = match[1] ?? '='
  const target = parseVersion(match[2])
  if (!target) return false
  const cmp = compare(version, target)
  switch (op) {
    case '>=': return cmp >= 0
    case '<=': return cmp <= 0
    case '>': return cmp > 0
    case '<': return cmp < 0
    case '=': return cmp === 0
    case '^': return version.major === target.major && cmp >= 0
    case '~': return version.major === target.major && version.minor === target.minor && cmp >= 0
    default: return false
  }
}

/**
 * Check a concrete capability version against a small range grammar:
 * exact, `*`, `^1.2.3`, `~1.2.3`, or a space-separated comparator set.
 */
export function satisfiesVersion(version, range) {
  const parsed = parseVersion(version)
  if (!parsed) return false
  const text = typeof range === 'string' ? range.trim() : ''
  if (text === '' || text === '*') return true
  return text.split(/\s+/).every((part) => comparatorSatisfied(parsed, part))
}

const HOST_CAPABILITIES = Object.freeze({
  'dsh.platform.manifest': '1.2.0',
  'dsh.platform.capabilities': '1.2.0',
  'dsh.platform.profiles': '1.2.0',
  'dsh.platform.adapters': '1.2.0',
  'dsh.platform.delivery': '1.2.0',
  'dsh.platform.invocation': '1.2.0',
})

/**
 * Build a Fabric-shaped host descriptor. The `profile`/`surfaces` fields and
 * `dsh.platform.*` capability names are our extension namespace; they are not
 * Fabric standard capability IDs.
 */
export function createHostDescriptor({
  id = 'dsh.platform-core',
  contract = '1.2',
  version = '0.1.0',
  surfaces = ['qq', 'web'],
  profiles = true,
  capabilities = {},
  trustMode = 'trusted-in-process',
} = {}) {
  return {
    descriptorVersion: '0.1.0',
    id,
    version,
    contract,
    execution: { environment: 'node', trustMode },
    apiVersions: ['0.1.0'],
    capabilities: { ...HOST_CAPABILITIES, ...capabilities },
    surfaces: [...surfaces],
    profiles: Boolean(profiles),
  }
}

function normalizeRequirements(input) {
  if (!input || typeof input !== 'object') return { required: [], optional: [] }
  const toList = (value) => {
    if (Array.isArray(value)) return value.map((id) => ({ id, range: '*' }))
    if (!value || typeof value !== 'object') return []
    return Object.entries(value).map(([id, range]) => ({
      id,
      range: typeof range === 'string' ? range : '*',
    }))
  }
  return {
    required: toList(input.required),
    optional: toList(input.optional),
  }
}

/**
 * Negotiate Fabric-style required/optional capabilities against a host
 * descriptor. Missing required capabilities are incompatible; missing optional
 * capabilities degrade rather than fail.
 */
export function negotiateCapabilities(requirements, host) {
  const normalized = normalizeRequirements(requirements)
  const available = host?.capabilities ?? {}
  const check = (item) => {
    const version = available[item.id]
    if (version === undefined) return { ...item, ok: false, reason: 'missing' }
    if (!satisfiesVersion(version, item.range)) {
      return { ...item, ok: false, reason: 'version-mismatch', available: version }
    }
    return { ...item, ok: true, available: version }
  }
  const required = normalized.required.map(check)
  const optional = normalized.optional.map(check)
  const missingRequired = required.filter((item) => !item.ok)
  const missingOptional = optional.filter((item) => !item.ok)
  return {
    status: missingRequired.length > 0
      ? 'incompatible'
      : missingOptional.length > 0 ? 'degraded' : 'compatible',
    required,
    optional,
    missingRequired,
    missingOptional,
  }
}

function capabilityIds(manifest) {
  return (manifest.capabilities ?? [])
    .map((capability) => capability?.id)
    .filter((id) => typeof id === 'string' && id.length > 0)
}

/**
 * Best-effort projection of our `dsh.platform` manifest into the shape that a
 * Fabric consumer can inspect. Domain capabilities are not Fabric host
 * capabilities, so they are exposed under `x-dsh` and the result is explicitly
 * marked `needs-adapter`.
 */
export function toFabricManifest(pkg = {}, { host } = {}) {
  const manifest = pkg.dsh?.platform ?? {}
  const requirements = manifest.requires ?? { required: {}, optional: {} }
  const negotiation = host ? negotiateCapabilities(requirements, host) : null
  const domainCapabilities = capabilityIds(manifest)
  return {
    manifestVersion: '0.1.0',
    id: pkg.name,
    name: pkg.name,
    version: pkg.version,
    apiVersion: manifest.contract ?? '1.0',
    entrypoints: pkg.main ? { host: pkg.main } : {},
    capabilities: {
      required: requirements.required ?? {},
      optional: requirements.optional ?? {},
    },
    contributes: {
      commands: [],
      'x-dsh': {
        capabilities: domainCapabilities,
        profiles: (manifest.profiles ?? []).map((profile) => profile.id),
      },
    },
    xDsh: {
      source: 'dsh.platform',
      status: 'needs-adapter',
      domainCapabilities,
      profiles: (manifest.profiles ?? []).map((profile) => profile.id),
      negotiation,
    },
  }
}

export function fabricCompatibility(pkg = {}, { host } = {}) {
  const projected = toFabricManifest(pkg, { host })
  return {
    status: projected.xDsh.status,
    reasons: [
      'Fabric is a Draft; no dsh-plugin.json manifest is emitted by default',
      'domain capabilities are not Fabric host capabilities',
    ],
    manifest: projected,
    negotiation: projected.xDsh.negotiation,
  }
}

export { HOST_CAPABILITIES }
