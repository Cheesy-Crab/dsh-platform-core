import os from 'node:os'
import path from 'node:path'

import { AgentExtensionRegistry } from './agent-registry.js'
import { AdapterHost } from './adapter-host.js'
import { DeliveryCoordinator } from './delivery-coordinator.js'
import { InvocationLedger } from './invocation-ledger.js'
import { createPlatformStatus } from './status.js'
import { isPrimaryAgent, platformPromptAllowed, profileCapabilitiesMode, profileForAgent } from './agent-policy.js'
import { ProfileRegistry } from './profiles.js'
import { discoverPlugins, PluginRegistry } from './registry.js'
import { buildCapabilityBrief, installCapabilityPrompt } from './prompts/capabilities.prompt.js'
import { installCreativePrompt } from './prompts/creative.prompt.js'
import { installToolFailurePrompt } from './prompts/tool-failures.prompt.js'

export { AgentExtensionRegistry } from './agent-registry.js'
export { AdapterHost } from './adapter-host.js'
export { ProfileRegistry } from './profiles.js'
export { readPlatformManifest, validatePlatformManifest } from './manifest.js'
export { createPluginAdapter, classifyPlugin, adaptToolResult } from './plugin-adapter.js'
export { discoverPlugins, PluginRegistry } from './registry.js'
export { forwardMediaOutputs, generatedImageRecords, generatedImages } from './delivery.js'
export { DeliveryCoordinator } from './delivery-coordinator.js'
export { InvocationLedger } from './invocation-ledger.js'
export { createPlatformStatus } from './status.js'
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
export async function apply(ctx, rawConfig = {}) {
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
  let pluginInventory
  try {
    const service = ctx.get?.('pluginInventory')
    if (service && typeof service.list === 'function') {
      pluginInventory = await service.list()
      log('info', `plugin inventory: ${pluginInventory?.entries?.length ?? 0} entries`)
    }
  } catch (error) {
    log('warn', `could not read plugin inventory: ${error?.message ?? error}`)
  }
  let pluginRegistry
  try {
    pluginRegistry = new PluginRegistry(discoverPlugins({
      profileDir,
      inventory: pluginInventory,
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

  const profileRegistry = new ProfileRegistry(pluginRegistry.profiles())
  const capabilityBriefs = {
    index: buildCapabilityBrief(pluginRegistry.capabilities(), { max: 20 }),
    full: buildCapabilityBrief(pluginRegistry.capabilities(), { max: 50 }),
  }
  try {
    ctx.provide('conversationProfiles', profileRegistry)
  } catch (error) {
    log('warn', `could not provide conversationProfiles: ${error?.message ?? error}`)
  }

  try {
    const offCreated = ctx.on?.('agent/created', ({ agent, source }) => {
      if (!isPrimaryAgent(agent, source)) return
      const profile = profileForAgent(agent, profileRegistry)
      if (profile) agent.__platformProfile = profile
      const state = agent.__platformState ?? (agent.__platformState = {})
      if (platformPromptAllowed(profile)) {
        installToolFailurePrompt(agent, state, log)
        installCreativePrompt(agent, state, log)
      }
      const capabilitiesMode = profileCapabilitiesMode(profile)
      if (capabilitiesMode !== 'none') {
        installCapabilityPrompt(agent, state, capabilityBriefs[capabilitiesMode], log)
      }
    })
    if (typeof offCreated === 'function') disposers.push(offCreated)
  } catch (error) {
    log('warn', `could not subscribe to agent/created: ${error?.message ?? error}`)
  }

  const deliveryCoordinator = new DeliveryCoordinator({ log })
  const invocationLedger = new InvocationLedger({ log })
  try {
    ctx.provide('deliveryCoordinator', deliveryCoordinator)
    ctx.provide('invocationLedger', invocationLedger)
  } catch (error) {
    log('warn', `could not provide delivery services: ${error?.message ?? error}`)
  }

  const adapterHost = new AdapterHost({ ctx, registry, profiles: profileRegistry, deliveryCoordinator, invocationLedger, log })
  try {
    ctx.provide('adapterHost', adapterHost)
    ctx.provide('platformStatus', createPlatformStatus({
      pluginRegistry,
      profileRegistry,
      deliveryCoordinator,
      invocationLedger,
    }))
  } catch (error) {
    log('warn', `could not provide adapterHost/status: ${error?.message ?? error}`)
  }

  ctx.effect?.(() => () => {
    adapterHost.dispose()
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch {}
    }
  })
}
