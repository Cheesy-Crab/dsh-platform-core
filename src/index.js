import os from 'node:os'
import path from 'node:path'

import { AgentExtensionRegistry } from './agent-registry.js'
import { discoverPlugins, PluginRegistry } from './registry.js'
import { installCreativePrompt } from './prompts/creative.prompt.js'
import { installToolFailurePrompt } from './prompts/tool-failures.prompt.js'

export { AgentExtensionRegistry } from './agent-registry.js'
export { createPluginAdapter, classifyPlugin, adaptToolResult } from './plugin-adapter.js'
export { discoverPlugins, PluginRegistry } from './registry.js'
export { forwardMediaOutputs, generatedImageRecords, generatedImages } from './delivery.js'
export { installCreativePrompt } from './prompts/creative.prompt.js'
export { installToolFailurePrompt } from './prompts/tool-failures.prompt.js'

export const name = 'dsh-platform-core'

function defaultProfileDir() {
  const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
  return path.join(home, 'profiles', process.env.DSH_PROFILE ?? 'desktop')
}

/**
 * Cordis entry point for the surface-neutral platform core. It owns the
 * agent-extension registry, installs generic prompts, and exposes discovered
 * plugins. It never imports QQ, NapCat or OneBot.
 */
export function apply(ctx, rawConfig = {}) {
  const log = (level, message) => {
    const line = `[platform-core] ${message}`
    try {
      const logger = ctx.logger
      const write = logger?.[level]
      if (typeof write === 'function') write.call(logger, line)
    } catch {
      // diagnostics must not break startup
    }
  }

  let registry
  try {
    registry = ctx.get('agentExtensions')
  } catch {
    registry = undefined
  }
  if (!registry) {
    registry = new AgentExtensionRegistry({ log })
    try {
      ctx.provide('agentExtensions', registry)
    } catch (error) {
      log('warn', `could not provide agentExtensions: ${error?.message ?? error}`)
    }
  }

  const disposers = []
  try {
    disposers.push(registry.register({
      name: 'platform:tool-failures',
      onSession: ({ agent, state }) => installToolFailurePrompt(agent, state, log),
    }))
    disposers.push(registry.register({
      name: 'platform:creative',
      onSession: ({ agent, state }) => installCreativePrompt(agent, state, log),
    }))
  } catch (error) {
    log('warn', `could not register platform prompts: ${error?.message ?? error}`)
  }

  const profileDir = rawConfig.profileDir ?? defaultProfileDir()
  let pluginRegistry
  try {
    pluginRegistry = new PluginRegistry(discoverPlugins({
      profileDir,
      ignore: ['@dsh/platform-core', '@dsh/session-core', 'dsh-qq-bridge'],
    }))
    log('info', `discovered ${pluginRegistry.list().length} plugin(s) from ${profileDir}`)
  } catch (error) {
    log('warn', `plugin discovery failed: ${error?.message ?? error}`)
    pluginRegistry = new PluginRegistry()
  }
  try {
    ctx.provide('pluginRegistry', pluginRegistry)
  } catch (error) {
    log('warn', `could not provide pluginRegistry: ${error?.message ?? error}`)
  }

  ctx.effect?.(() => () => {
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch {}
    }
  })
}
