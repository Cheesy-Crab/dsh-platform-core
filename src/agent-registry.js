/**
 * Registry for agent behavior extensions.
 *
 * Platform prompts and communication-surface extensions register here. The
 * registry is platform-owned; QQ, Telegram and Web are just consumers.
 */
export class AgentExtensionRegistry {
  constructor({ log } = {}) {
    this.log = log
    this.extensions = []
  }

  register(extension) {
    if (!extension || typeof extension.name !== 'string' || extension.name === '') {
      throw new Error('agent extension requires a non-empty name')
    }
    if (this.extensions.some((item) => item.name === extension.name)) {
      throw new Error(`agent extension already registered: ${extension.name}`)
    }
    this.extensions.push(extension)
    return () => {
      this.extensions = this.extensions.filter((item) => item !== extension)
    }
  }

  list() {
    return [...this.extensions]
  }

  async sessionReady(context) {
    for (const extension of this.list()) {
      try {
        await extension.onSession?.(context)
      } catch (error) {
        this.log?.('warn', `agent extension ${extension.name} onSession failed: ${error?.message ?? error}`)
      }
    }
  }

  async turnEnd(context) {
    for (const extension of this.list()) {
      try {
        await extension.onTurnEnd?.(context)
      } catch (error) {
        this.log?.('warn', `agent extension ${extension.name} onTurnEnd failed: ${error?.message ?? error}`)
      }
    }
  }
}
