import { randomUUID } from 'node:crypto'

import { forwardMediaOutputs } from './delivery.js'

/**
 * Composition root for communication adapters. Adapters only receive this
 * context and never import the platform or session implementations directly.
 */
export class AdapterHost {
  constructor({
    ctx,
    registry,
    profiles,
    deliveryCoordinator,
    invocationLedger,
    effectLedger,
    generations,
    log = () => {},
  }) {
    this.ctx = ctx
    this.registry = registry
    this.profiles = profiles
    this.deliveryCoordinator = deliveryCoordinator
    this.invocationLedger = invocationLedger
    this.effectLedger = effectLedger
    this.generations = generations
    this.log = log
    this.instances = []
  }

  resolveWorkspacesRoot(raw) {
    const sessionService = this.ctx.get?.('sessionService')
    if (typeof sessionService?.resolveWorkspacesRoot !== 'function') {
      throw new Error('sessionService.resolveWorkspacesRoot is not available')
    }
    return sessionService.resolveWorkspacesRoot(raw)
  }

  mount(adapter, options = {}) {
    if (!adapter || typeof adapter.id !== 'string' || typeof adapter.mount !== 'function') {
      throw new Error('adapter must expose { id, mount(host) }')
    }
    if (!this.registry) throw new Error('platform agentExtensions is not available')
    let sessionService
    let accessService
    try {
      sessionService = this.ctx.get('sessionService')
      accessService = this.ctx.get('accessService')
    } catch {
      sessionService = undefined
      accessService = undefined
    }
    if (!sessionService?.createManager) throw new Error('sessionService is not available')
    if (!accessService?.createStore) throw new Error('accessService is not available')

    const activation = {
      pluginId: typeof adapter.pluginId === 'string' && adapter.pluginId.length > 0
        ? adapter.pluginId
        : adapter.id,
      activationId: `act-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
    }
    try {
      this.effectLedger?.record({
        owner: activation,
        effectId: `adapter:${adapter.id}`,
        effectKind: 'adapter.lifecycle',
        operation: 'create',
        state: 'active',
        resourceId: activation.activationId,
      })
    } catch (error) {
      this.log('warn', `could not record adapter activation: ${error?.message ?? error}`)
    }

    const host = {
      id: adapter.id,
      config: options.config,
      root: options.root,
      log: this.log,
      extensions: this.registry,
      profiles: this.profiles,
      resolveProfile: (id) => this.profiles?.resolve?.(id),
      deliveryCoordinator: this.deliveryCoordinator,
      invocationLedger: this.invocationLedger,
      owner: activation,
      generations: this.generations,
      createSessionManager: (managerOptions) => sessionService.createManager(managerOptions),
      createUserStore: (storeOptions) => accessService.createStore(storeOptions),
      resolveWorkspacesRoot: (raw) => sessionService.resolveWorkspacesRoot(raw),
      access: {
        normalizeCapabilities: (value) => accessService.normalizeCapabilities(value),
        normalizeLevel: (value) => accessService.normalizeLevel(value),
        atLeast: (level, minimum) => accessService.atLeast(level, minimum),
        toolAllowed: (tool, capabilities) => accessService.toolAllowed(tool, capabilities),
      },
      registerExtensions: (extensions) => extensions.map((extension) => this.registry.register(extension)),
      forwardMediaOutputs: (mediaOptions) => forwardMediaOutputs({
        ...mediaOptions,
        deliveryCoordinator: mediaOptions.deliveryCoordinator ?? this.deliveryCoordinator,
        owner: mediaOptions.owner ?? activation,
      }),
    }
    const instance = adapter.mount(host)
    this.instances.push({ adapter, instance, owner: activation })
    this.log('info', `adapter mounted: ${adapter.id}`)
    return instance
  }

  dispose() {
    for (const { adapter, instance, owner } of this.instances.splice(0)) {
      try {
        if (typeof instance?.stop === 'function') instance.stop()
        else if (typeof adapter?.stop === 'function') adapter.stop()
        this.effectLedger?.record({
          owner,
          effectId: `adapter:${adapter.id}`,
          effectKind: 'adapter.lifecycle',
          operation: 'release',
          state: 'released',
          resourceId: owner?.activationId,
        })
      } catch (error) {
        try {
          this.effectLedger?.record({
            owner,
            effectId: `adapter:${adapter.id}`,
            effectKind: 'adapter.lifecycle',
            operation: 'cleanup-failed',
            state: 'failed',
            resourceId: owner?.activationId,
            errorCode: 'adapter-stop-failed',
            outcome: String(error?.message ?? error),
          })
        } catch (failure) {
          this.log('warn', `could not record adapter cleanup failure: ${failure?.message ?? failure}`)
        }
        this.log('warn', `adapter stop failed: ${adapter.id}: ${error?.message ?? error}`)
      }
    }
  }
}
