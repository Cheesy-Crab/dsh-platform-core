const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i

function list(value) {
  return Array.isArray(value) ? value : []
}

function slug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin'
}

function inferKind(name) {
  const value = String(name ?? '').toLowerCase()
  if (/(send|message|reply|notify|mail|chat|qq|post)/.test(value)) return 'communication'
  if (/(memory|remember|archive|history|session)/.test(value)) return 'memory'
  if (/(skill|knowledge|prompt|guide|document)/.test(value)) return 'knowledge'
  if (/(read|get|list|search|find|fetch|browse|look|view|glob|grep|inspect|screenshot|status|health)/.test(value)) return 'perception'
  if (/(generate|create|edit|draw|render|write|save|exec|run|build|transform|upscale|inpaint|complete)/.test(value)) return 'action'
  return 'action'
}

function inferOutputs(tool) {
  if (Array.isArray(tool.outputs) && tool.outputs.length > 0) return [...tool.outputs]
  const value = String(tool.name ?? '').toLowerCase()
  if (/(image|draw|render|generate|edit|upscale|inpaint|photo|picture)/.test(value)) return ['image']
  return []
}

function inferEffects(tool, kind, outputs) {
  if (Array.isArray(tool.effects) && tool.effects.length > 0) return [...tool.effects]
  const value = String(tool.name ?? '').toLowerCase()
  const effects = new Set()
  if (kind === 'perception') effects.add('read')
  if (kind === 'communication') {
    effects.add('network')
    effects.add('external_effect')
  }
  if (kind === 'action') {
    effects.add('write')
  }
  if (outputs.includes('image')) {
    effects.add('network')
    effects.add('cost')
  }
  if (/(exec|shell|run|command|terminal)/.test(value)) effects.add('exec')
  if (/(fetch|browse|search|http|remote|api|download|upload|web)/.test(value)) effects.add('network')
  return [...effects]
}

function inferPermissions(tool, kind, outputs) {
  if (Array.isArray(tool.permissions) && tool.permissions.length > 0) return [...tool.permissions]
  const permissions = new Set()
  if (outputs.includes('image')) permissions.add('image')
  if (kind === 'communication') permissions.add('communication')
  if (/(exec|shell|run|command|terminal)/i.test(String(tool.name ?? ''))) permissions.add('exec')
  return [...permissions]
}

function confidenceOf(tool, kind, outputs) {
  if (Array.isArray(tool.outputs) && tool.outputs.length > 0) return 'high'
  if (outputs.length > 0) return 'high'
  if (/(generate|create|edit|draw|render|write|exec|run|read|get|list|search|find|fetch|browse|send|message|reply)/i.test(String(tool.name ?? ''))) return 'medium'
  if (kind === 'action') return 'low'
  return 'medium'
}

function inferCapability(tool, defaults) {
  const kind = tool.kind ?? inferKind(tool.name)
  const outputs = inferOutputs(tool)
  const effects = inferEffects(tool, kind, outputs)
  const permissions = inferPermissions(tool, kind, outputs)
  const confidence = confidenceOf(tool, kind, outputs)
  const id = typeof tool.capability === 'string' && tool.capability.length > 0
    ? tool.capability
    : `${kind}.${slug(tool.name)}`
  return {
    id,
    kind,
    title: tool.title ?? String(tool.name ?? id),
    ...(tool.description === undefined ? {} : { description: String(tool.description) }),
    effects,
    permissions: permissions.length > 0 ? permissions : list(defaults.permissions),
    bind: { tool: String(tool.name) },
    delivery: outputs,
    confidence,
    inferred: true,
    requiresReview: confidence === 'low'
      || effects.includes('exec')
      || effects.includes('network')
      || effects.includes('external_effect'),
    ...(tool.retry === undefined ? {} : { retry: tool.retry }),
  }
}

/**
 * Classify a plugin manifest without requiring it to implement the full
 * capability contract. The result is deliberately conservative: inferred
 * capabilities are marked, and settings that can affect the host or money
 * require a human review before they are trusted.
 *
 * @param {any} manifest package.json's dsh object, or an object with `dsh`.
 * @param {{ pluginId?: string }} [options]
 */
export function classifyPlugin(manifest, options = {}) {
  const dsh = manifest?.dsh && typeof manifest.dsh === 'object' ? manifest.dsh : (manifest ?? {})
  const pluginId = options.pluginId ?? dsh.name ?? 'unknown'
  const warnings = []
  const prompts = list(dsh.prompts)
  const skills = list(dsh.skills)

  if (Array.isArray(dsh.capabilities) && dsh.capabilities.length > 0) {
    return {
      pluginId,
      level: 'native',
      capabilities: dsh.capabilities.map((capability) => ({ ...capability, inferred: false })),
      prompts,
      skills,
      warnings,
      requiresReview: false,
    }
  }

  const tools = list(dsh.tools)
  if (tools.length > 0) {
    const capabilities = tools.map((tool) => inferCapability(tool, dsh))
    const review = capabilities.some((capability) => capability.requiresReview)
    if (review) warnings.push('旧插件含网络/执行/外部副作用或低置信能力，需人工确认')
    return {
      pluginId,
      level: 'legacy-tools',
      capabilities,
      prompts,
      skills,
      warnings,
      requiresReview: review,
    }
  }

  if (prompts.length > 0 || skills.length > 0) {
    return {
      pluginId,
      level: 'knowledge-only',
      capabilities: [{
        id: `knowledge.${slug(pluginId)}`,
        kind: 'knowledge',
        title: pluginId,
        prompts,
        inferred: true,
        requiresReview: false,
      }],
      prompts,
      skills,
      warnings,
      requiresReview: false,
    }
  }

  warnings.push('插件没有 capabilities/tools/prompts，只能按未知插件观察')
  return {
    pluginId,
    level: 'unknown',
    capabilities: [],
    prompts: [],
    skills: [],
    warnings,
    requiresReview: true,
  }
}

/**
 * Create a runtime adapter. QQ Bridge and other surfaces can use this without
 * knowing any plugin's private names.
 */
export function createPluginAdapter(manifest, options = {}) {
  const classification = classifyPlugin(manifest, options)
  return Object.freeze({
    ...classification,
    capabilityForTool(toolName) {
      return classification.capabilities.find(
        (capability) => capability.bind?.tool === toolName
          || capability.bind?.tools?.includes(toolName),
      )
    },
    normalizeResult: adaptToolResult,
  })
}

function pathOutputs(value, outputs, seen) {
  if (value === null || typeof value !== 'object') return
  if (typeof value.savedTo === 'string' && IMAGE_EXT.test(value.savedTo) && !seen.has(value.savedTo)) {
    seen.add(value.savedTo)
    outputs.push({ kind: 'image', path: value.savedTo, mime: mimeOf(value.savedTo) })
  }
  for (const file of list(value.files)) {
    if (typeof file === 'string' && IMAGE_EXT.test(file) && !seen.has(file)) {
      seen.add(file)
      outputs.push({ kind: 'image', path: file, mime: mimeOf(file) })
    }
  }
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && child !== value) pathOutputs(child, outputs, seen)
  }
}

function mimeOf(file) {
  if (/\.png$/i.test(file)) return 'image/png'
  if (/\.gif$/i.test(file)) return 'image/gif'
  if (/\.webp$/i.test(file)) return 'image/webp'
  if (/\.bmp$/i.test(file)) return 'image/bmp'
  return 'image/jpeg'
}

function legacyCost(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return { amount: value, unit: 'buzz' }
  if (value !== null && typeof value === 'object' && typeof value.total === 'number') {
    return { amount: value.total, unit: 'buzz' }
  }
  return undefined
}

/**
 * Normalize a tool result into the platform contract. Native `meta.dsh`
 * results win; legacy `savedTo`/`cost` shapes are adapted for migration.
 *
 * @param {any} meta tool result metadata
 */
export function adaptToolResult(meta) {
  if (meta === null || typeof meta !== 'object') return { outputs: [] }
  const native = meta.dsh
  if (native !== null && typeof native === 'object') {
    return {
      source: 'native',
      outputs: list(native.outputs).filter((output) => output && typeof output === 'object'),
      ...(native.cost === undefined ? {} : { cost: native.cost }),
      ...(native.operation === undefined ? {} : { operation: native.operation }),
      ...(native.retry === undefined ? {} : { retry: native.retry }),
      ...(native.error === undefined ? {} : { error: native.error }),
    }
  }

  const outputs = []
  pathOutputs(meta, outputs, new Set())
  const cost = legacyCost(meta.cost)
  return {
    source: 'legacy',
    outputs,
    ...(cost === undefined ? {} : { cost }),
  }
}
