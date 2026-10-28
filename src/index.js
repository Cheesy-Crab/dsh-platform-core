import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

import { AgentExtensionRegistry } from './agent-registry.js'
import { AdapterHost } from './adapter-host.js'
import { DeliveryCoordinator } from './delivery-coordinator.js'
import { EffectLedger } from './effect-ledger.js'
import { InvocationLedger } from './invocation-ledger.js'
import { createPlatformStatus } from './status.js'
import { createHostDescriptor, fabricCompatibility } from './fabric.js'
import { effectiveProfileForAgent, isPrimaryAgent, platformPromptAllowed, profileCapabilitiesMode, recordEffectiveProfile } from './agent-policy.js'
import { ProfileRegistry } from './profiles.js'
import { discoverPlugins, inventoryFromLoader, PluginRegistry } from './registry.js'
import { buildCapabilityBrief, installCapabilityPrompt } from './prompts/capabilities.prompt.js'
import { installCreativePrompt } from './prompts/creative.prompt.js'
import { installToolFailurePrompt } from './prompts/tool-failures.prompt.js'
import { applyToolExposure, knownToolNames } from './tool-exposure.js'
import { applyToolGuard } from './tool-guard.js'
import { LEGACY_CAPABILITY_BINDINGS } from './capability-bindings.js'
import { repairProfileCapabilities } from './capability-validation.js'
import { expandCapabilityFamilies } from './capability-family.js'
import { ProfileStateStore } from './profile-state.js'
import { UserCapabilityStore } from './user-capability-state.js'
import { createProfilePredictor } from './profile-predictor.js'
import { PredictionLog } from './prediction-log.js'
import { collectToolUsage, toolCapabilityMap } from './tool-usage.js'
import { sessionEventsFrom } from './events.js'

export { AgentExtensionRegistry } from './agent-registry.js'
export { AdapterHost } from './adapter-host.js'
export { ProfileRegistry } from './profiles.js'
export { readPlatformManifest, validatePlatformManifest } from './manifest.js'
export { createPluginAdapter, classifyPlugin, adaptToolResult } from './plugin-adapter.js'
export { discoverPlugins, inventoryFromLoader, PluginRegistry } from './registry.js'
export { forwardMediaOutputs, generatedImageRecords, generatedImages } from './delivery.js'
export { DeliveryCoordinator } from './delivery-coordinator.js'
export { EffectLedger } from './effect-ledger.js'
export { InvocationLedger } from './invocation-ledger.js'
export { createPlatformStatus } from './status.js'
export { createHostDescriptor, fabricCompatibility, negotiateCapabilities, satisfiesVersion, toFabricManifest } from './fabric.js'
export { applyToolExposure, capabilityToolMap } from './tool-exposure.js'
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
    const discovered = discoverPlugins({
      profileDir,
      ignore: ['@dsh/platform-core', '@dsh/session-core', 'dsh-qq-bridge'],
    })
    const inventory = inventoryFromLoader(ctx.get?.('loader') ?? ctx.loader)
    const byName = new Map((inventory ?? []).map((entry) => [entry.moduleName, entry]))
    pluginRegistry = new PluginRegistry(discovered.filter((plugin) => {
      const entry = byName.get(plugin.name)
      if (!entry) return true
      return entry.enabled !== false && entry.fiberPhase !== 'failed' && entry.fiberPhase !== 'disposed'
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
  const profileState = new ProfileStateStore({
    root: rawConfig.profileStateDir ?? path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'platform', 'profiles'),
    log,
  })
  const userState = new UserCapabilityStore({
    root: rawConfig.userStateDir ?? path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'platform', 'users'),
  })
  const predictionLog = new PredictionLog({
    file: rawConfig.predictionLogFile ?? path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'platform', 'predictions.jsonl'),
  })
  const managedCapabilities = [
    ...pluginRegistry.capabilities(),
    ...(Array.isArray(rawConfig.capabilityBindings) ? rawConfig.capabilityBindings : []),
    ...LEGACY_CAPABILITY_BINDINGS,
  ]
  if (rawConfig.builtinProfiles !== false
    && fs.existsSync(path.join(profileDir, 'node_modules', 'dsh-image-gen', 'package.json'))) {
    profileRegistry.add({
      id: 'image',
      kind: 'action',
      title: 'Image',
      agentPreset: 'standard',
      surfaces: ['qq', 'web'],
      capabilities: ['image.generate'],
      families: ['image'],
    })
  }
  const capabilityBriefs = new Map()
  const briefFor = (agent, profile, mode) => {
    const active = Array.isArray(profile?.capabilities) ? new Set(profile.capabilities) : undefined
    const known = knownToolNames(agent)
    const knownKey = known ? [...known].sort().join(',') : '*'
    const key = `${mode}|${active ? [...active].sort().join(',') : '*'}`
    const cacheKey = `${key}|${knownKey}`
    if (!capabilityBriefs.has(cacheKey)) {
      let available = active
        ? managedCapabilities.filter((capability) => active.has(capability.id))
        : managedCapabilities
      if (known) {
        available = available.filter((capability) => {
          const tool = capability?.bind?.tool
          return !tool || known.has(tool)
        })
      }
      capabilityBriefs.set(cacheKey, buildCapabilityBrief(available, { max: mode === 'full' ? 50 : 20 }))
    }
    return capabilityBriefs.get(cacheKey)
  }
  const profilePredictor = createProfilePredictor({
    profiles: profileRegistry,
    userState,
    capabilities: managedCapabilities,
  })
  try {
    ctx.provide('conversationProfiles', profileRegistry)
    ctx.provide('profileState', profileState)
    ctx.provide('userCapabilityState', userState)
    ctx.provide('profilePredictor', profilePredictor)
  } catch (error) {
    log('warn', `could not provide conversationProfiles/profileState: ${error?.message ?? error}`)
  }

  try {
    const offCreated = ctx.on?.('agent/created', ({ agent, source }) => {
      if (!isPrimaryAgent(agent, source)) return
      const predictor = ctx.get?.('profilePredictor')
      const { profile, source: profileSource, predictionError } = effectiveProfileForAgent(agent, profileRegistry, { predictor })
      if (predictionError) {
        log('warn', `profile prediction failed: ${predictionError?.message ?? predictionError}`)
      }
      const repaired = repairProfileCapabilities(profile, managedCapabilities, {
        onUnknown: (id) => log('warn', `unknown active capability: ${id}`),
      })
      const effectiveProfile = profileSource === 'predicted'
        ? expandCapabilityFamilies(repaired.profile, managedCapabilities)
        : repaired.profile
      if (effectiveProfile) agent.__platformProfile = effectiveProfile
      agent.__platformProfileSource = profileSource
      recordEffectiveProfile(agent, effectiveProfile, profileSource)
      predictionLog.record({
        sessionId: agent.session?.header?.id,
        requester: agent.session?.meta?.requester,
        principal: agent.session?.meta?.principal,
        source: profileSource,
        profileId: effectiveProfile?.id,
        predictionError: predictionError?.message,
      })
      const state = agent.__platformState ?? (agent.__platformState = {})
      if (platformPromptAllowed(effectiveProfile)) {
        installToolFailurePrompt(agent, state, log)
        installCreativePrompt(agent, state, log)
      }
      const capabilitiesMode = profileCapabilitiesMode(effectiveProfile)
      if (capabilitiesMode !== 'none') {
        installCapabilityPrompt(agent, state, briefFor(agent, effectiveProfile, capabilitiesMode), log)
      }
    })
    if (typeof offCreated === 'function') disposers.push(offCreated)
  } catch (error) {
    log('warn', `could not subscribe to agent/created: ${error?.message ?? error}`)
  }

  try {
    disposers.push(registry.register({
      name: 'platform:tool-exposure',
      onSession: ({ agent, profile }) => {
        const effective = agent.__platformProfile ?? (profile?.id ? profile : undefined)
        applyToolExposure(agent, {
          capabilities: managedCapabilities,
          profile: effective,
          onError: (error, detail) => log('warn', `tool exposure failed: ${error?.message ?? error}; deny=${detail?.deny?.join(',') ?? ''}`),
        })
        applyToolGuard(agent, {
          capabilities: managedCapabilities,
          profile: effective,
          onError: (error) => log('warn', `tool guard failed: ${error?.message ?? error}`),
        })
      },
    }))
    disposers.push(registry.register({
      name: 'platform:profile-state',
      onTurnEnd: ({ session, state, fromSeq }) => {
        const profileId = session?.meta?.effectiveProfileId ?? state?.profileId ?? 'default'
        if (!profileId) return
        const events = sessionEventsFrom(session, fromSeq)
        const usage = collectToolUsage(events, {
          toolCapability: toolCapabilityMap(managedCapabilities),
        })
        profileState.recordTurn({
          profileId,
          tools: usage,
          sessionId: session?.header?.id,
          chatKey: state?.key,
        })
        const requester = state?.requester
          ?? session?.meta?.requester
          ?? state?.principal
          ?? session?.meta?.principal
        if (requester) {
          userState.recordTurn({
            userId: requester,
            tools: usage,
            profileId,
            sessionId: session?.header?.id,
          })
        }
        const group = String(state?.principal ?? session?.meta?.principal ?? '')
        if (/^(qq-)?group:/.test(group) && group !== requester) {
          userState.recordTurn({
            userId: group,
            tools: usage,
            profileId,
            sessionId: session?.header?.id,
          })
        }
      },
    }))
  } catch (error) {
    log('warn', `could not register profile extensions: ${error?.message ?? error}`)
  }

  const generation = {
    id: `gen-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    startedAt: new Date().toISOString(),
  }
  const effectLedger = new EffectLedger({ generationId: generation.id, log })
  const deliveryCoordinator = new DeliveryCoordinator({ log, generationId: generation.id, effectLedger })
  const invocationLedger = new InvocationLedger({ log, generationId: generation.id })
  try {
    ctx.provide('deliveryCoordinator', deliveryCoordinator)
    ctx.provide('invocationLedger', invocationLedger)
    ctx.provide('platformGeneration', generation)
    ctx.provide('effectLedger', effectLedger)
  } catch (error) {
    log('warn', `could not provide delivery/generation services: ${error?.message ?? error}`)
  }

  const adapterHost = new AdapterHost({ ctx, registry, profiles: profileRegistry, deliveryCoordinator, invocationLedger, log })
  const hostDescriptor = createHostDescriptor({
    contract: '1.2',
    surfaces: ['qq', 'web'],
  })
  try {
    ctx.provide('adapterHost', adapterHost)
    ctx.provide('platformHostDescriptor', hostDescriptor)
    ctx.provide('fabricCompatibility', (pkg) => fabricCompatibility(pkg, { host: hostDescriptor }))
    ctx.provide('platformStatus', createPlatformStatus({
      pluginRegistry,
      profileRegistry,
      deliveryCoordinator,
      invocationLedger,
      effectLedger,
      generation,
      capabilityCount: managedCapabilities.length,
      profileState,
      userState,
      predictionLog,
      hostDescriptor,
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
