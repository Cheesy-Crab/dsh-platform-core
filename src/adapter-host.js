import { forwardMediaOutputs } from './delivery.js'

/**
 * Composition root for communication adapters. Adapters only receive this
 * context and never import the platform or session implementations directly.
 */
export class AdapterHost {
  constructor({ ctx, registry, log = () => {} }) {
    this.ctx = ctx
    this.registry = registry
    this.log = log
    this.instances = []
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

    const host = {
      id: adapter.id,
      config: options.config,
      root: options.root,
      log: this.log,
      extensions: this.registry,
      createSessionManager: (managerOptions) => sessionService.createManager(managerOptions),
      createUserStore: (storeOptions) => accessService.createStore(storeOptions),
      registerExtensions: (extensions) => extensions.map((extension) => this.registry.register(extension)),
      forwardMediaOutputs: (mediaOptions) => forwardMediaOutputs(mediaOptions),
    }
    const instance = adapter.mount(host)
    this.instances.push({ adapter, instance })
    this.log('info', `adapter mounted: ${adapter.id}`)
    return instance
  }

  dispose() {
    for (const { adapter, instance } of this.instances.splice(0)) {
      try {
        if (typeof instance?.stop === 'function') instance.stop()
        else if (typeof adapter?.stop === 'function') adapter.stop()
      } catch {
        // adapter teardown is best effort
      }
    }
  }
}
