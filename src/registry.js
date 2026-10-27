import fs from 'node:fs'
import path from 'node:path'

import { createPluginAdapter } from './plugin-adapter.js'

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function isDirectory(file) {
  try {
    return fs.statSync(file).isDirectory()
  } catch {
    return false
  }
}

function packageDirectories(nodeModules) {
  if (!isDirectory(nodeModules)) return []
  const out = []
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(nodeModules, entry.name)
    if (entry.name.startsWith('@')) {
      if (!isDirectory(full)) continue
      for (const child of fs.readdirSync(full, { withFileTypes: true })) {
        if (child.name.startsWith('.')) continue
        const scoped = path.join(full, child.name)
        if (isDirectory(scoped)) out.push(scoped)
      }
      continue
    }
    if (isDirectory(full)) out.push(full)
  }
  return out
}

/**
 * Discover installed DSH plugins from a profile's node_modules and optional
 * extra package directories. Only packages with a `dsh` manifest are
 * considered; each is classified without running plugin code.
 *
 * @param {{ profileDir?: string, extraDirs?: string[], ignore?: string[] }} [options]
 */
export function discoverPlugins(options = {}) {
  const nodeModules = options.profileDir
    ? path.join(options.profileDir, 'node_modules')
    : undefined
  const dirs = [
    ...(nodeModules ? packageDirectories(nodeModules) : []),
    ...(options.extraDirs ?? []).filter(isDirectory),
  ]
  const ignore = new Set(options.ignore ?? [])
  const found = new Map()

  for (const dir of dirs) {
    const pkg = readJson(path.join(dir, 'package.json'))
    if (!pkg?.name || !pkg?.dsh) continue
    if (ignore.has(pkg.name)) continue
    if (found.has(pkg.name)) continue
    const adapter = createPluginAdapter(pkg, { pluginId: pkg.name })
    found.set(pkg.name, {
      name: pkg.name,
      version: pkg.version,
      dir,
      manifest: pkg.dsh,
      level: adapter.level,
      capabilities: adapter.capabilities,
      prompts: adapter.prompts,
      skills: adapter.skills,
      warnings: adapter.warnings,
      requiresReview: adapter.requiresReview,
      adapter,
    })
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Runtime view of discovered plugins. Communication adapters can ask this
 * registry which capabilities exist, which tool belongs to which capability,
 * and which prompts are relevant to the current surface.
 */
export class PluginRegistry {
  constructor(plugins = []) {
    this.plugins = []
    for (const plugin of plugins) this.add(plugin)
  }

  add(plugin) {
    if (!plugin?.name) throw new Error('plugin name is required')
    const index = this.plugins.findIndex((item) => item.name === plugin.name)
    if (index === -1) this.plugins.push(plugin)
    else this.plugins[index] = plugin
    return plugin
  }

  list() {
    return [...this.plugins]
  }

  capabilities() {
    return this.plugins.flatMap((plugin) => plugin.capabilities.map((capability) => ({
      ...capability,
      plugin: plugin.name,
    })))
  }

  tools() {
    return this.capabilities()
      .filter((capability) => capability.bind?.tool)
      .map((capability) => ({
        tool: capability.bind.tool,
        capability: capability.id,
        plugin: capability.plugin,
      }))
  }

  forTool(toolName) {
    return this.capabilities().find((capability) => capability.bind?.tool === toolName)
  }

  prompts({ surfaces = [], tools = [] } = {}) {
    const activeTools = new Set(tools)
    return this.plugins.flatMap((plugin) => {
      if (plugin.level === 'unknown') return []
      return plugin.prompts.map((file) => ({
        plugin: plugin.name,
        file,
        capabilities: plugin.capabilities.map((capability) => capability.id),
        surfaces: [...surfaces],
        tools: [...activeTools],
      }))
    })
  }

  describe() {
    return {
      plugins: this.plugins.length,
      native: this.plugins.filter((plugin) => plugin.level === 'native').length,
      legacy: this.plugins.filter((plugin) => plugin.level === 'legacy-tools').length,
      knowledge: this.plugins.filter((plugin) => plugin.level === 'knowledge-only').length,
      unknown: this.plugins.filter((plugin) => plugin.level === 'unknown').length,
    }
  }
}
