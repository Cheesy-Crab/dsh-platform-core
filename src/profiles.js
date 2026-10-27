/**
 * Surface-neutral conversation profiles. A profile selects an agent preset and
 * declares prompt/tool ownership; it is not a capability action.
 */
export class ProfileRegistry {
  constructor(profiles = []) {
    this.profiles = []
    this.providers = new Map()
    for (const profile of profiles) this.add(profile)
  }

  registerProvider(provider) {
    if (!provider || typeof provider.id !== 'string' || provider.id.length === 0) {
      throw new Error('profile provider id is required')
    }
    if (typeof provider.bind !== 'function') {
      throw new Error(`profile provider ${provider.id} must implement bind()`)
    }
    this.providers.set(provider.id, provider)
    if (provider.profile) this.add({ ...provider.profile, id: provider.id })
    return provider
  }

  providerFor(id) {
    return this.providers.get(id)
  }

  providersList() {
    return [...this.providers.values()]
  }

  async bind(id, context = {}) {
    const provider = this.providerFor(id)
    if (!provider) return { ok: false, reason: 'provider_missing' }
    await provider.bind({ ...context, profileId: id })
    return { ok: true }
  }

  add(profile) {
    if (!profile || typeof profile.id !== 'string' || profile.id.length === 0) {
      throw new Error('profile id is required')
    }
    const index = this.profiles.findIndex((item) => item.id === profile.id)
    if (index === -1) this.profiles.push(profile)
    else this.profiles[index] = profile
    return profile
  }

  list() {
    return [...this.profiles]
  }

  get(id) {
    return this.profiles.find((profile) => profile.id === id)
  }

  bySurface(surface) {
    return this.profiles.filter((profile) =>
      !Array.isArray(profile.surfaces) || profile.surfaces.includes(surface))
  }

  resolve(id, fallback = {}) {
    const profile = this.get(id)
    if (!profile) return undefined
    return {
      ...profile,
      agentPreset: profile.agentPreset ?? fallback.agentPreset,
      promptPolicy: profile.promptPolicy ?? fallback.promptPolicy,
      toolPolicy: profile.toolPolicy ?? fallback.toolPolicy,
    }
  }

  describe() {
    return {
      profiles: this.profiles.length,
      ids: this.profiles.map((profile) => profile.id),
    }
  }
}
