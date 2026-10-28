/**
 * Read-only platform health snapshot. It intentionally contains counts and
 * revisions rather than plugin internals, so it can be exposed over HTTP or a
 * remote method without leaking prompts or credentials.
 */
export function createPlatformStatus({ pluginRegistry, profileRegistry, deliveryCoordinator, invocationLedger, effectLedger, generation, hostDescriptor } = {}) {
  return () => ({
    ...(hostDescriptor ? { host: hostDescriptor } : {}),
    ...(generation ? { generation } : {}),
    ...(effectLedger ? { effects: effectLedger.stats() } : {}),
    plugins: pluginRegistry?.describe?.() ?? null,
    capabilities: pluginRegistry?.capabilities?.().length ?? 0,
    profiles: profileRegistry?.describe?.() ?? null,
    delivery: deliveryCoordinator?.stats?.() ?? null,
    invocations: invocationLedger?.stats?.() ?? null,
  })
}
