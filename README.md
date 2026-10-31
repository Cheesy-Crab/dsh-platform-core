# dsh-platform-core

Surface-neutral runtime for DSH: the platform is the person, plugins are its abilities. QQ, Web, Telegram and other communication surfaces are optional adapters; the core never knows which one is in use.

## What this is

```text
platform core
├─ agent extension registry
├─ plugin discovery
├─ capability classification
├─ generic prompt policy
├─ media delivery router
└─ session event access
```

It does **not** contain:

- QQ / OneBot / NapCat transport
- QQ numbers, group rules or mention handling
- image-gen / Civitai-specific code
- plugin private result fields

## Install

DSH Desktop → Plugins → Add plugin → install this repository:

```text
https://github.com/Cheesy-Crab/dsh-platform-core.git
```

The bundle patch inserts `platform-core` into the profile. Load it before any communication adapter:

```text
@dsh/platform-core
dsh-qq-bridge   # optional
```

## Services

The plugin provides:

| service | purpose |
|---|---|
| `agentExtensions` | shared session/turn extension registry |
| `pluginRegistry` | discovered plugins and inferred capabilities |
| `conversationProfiles` | manifest/profile registry |
| `profileState` / `userCapabilityState` | persistent usage stats |
| `profilePredictor` | default profile from user stats |
| `deliveryCoordinator` | at-most-once media delivery |
| `invocationLedger` | at-most-once tool execution |
| `effectLedger` | effect ownership records |
| `platformGeneration` / `platformGenerations` | process generation / per-session generation boundaries |
| `adapterHost` | composition root for communication adapters |
| `platformStatus` | read-only health snapshot |

Communication adapters should consume these services instead of creating their own registry.

## API

```js
import {
  discoverPlugins,
  PluginRegistry,
  classifyPlugin,
  createPluginAdapter,
  adaptToolResult,
  forwardMediaOutputs,
} from '@dsh/platform-core'
```

### Discover installed plugins

```js
const plugins = discoverPlugins({
  profileDir: 'C:/Users/me/.dsh/profiles/desktop',
})

const registry = new PluginRegistry(plugins)
registry.forTool('generate_image')
registry.capabilities()
registry.prompts({ surfaces: ['qq'] })
```

Discovery only reads each package's `dsh` manifest; plugin code is not executed.

### Classify without a capability contract

```text
capabilities       → native
tools only         → legacy-tools (inferred, review required for dangerous effects)
prompts/skills only→ knowledge-only
nothing            → unknown (observe only)
```

### Normalize results

```js
const normalized = adaptToolResult(toolResult.meta)
```

Native `meta.dsh` wins; legacy `savedTo` / `cost.total` are adapted during migration.

## Result contract

```json
{
  "meta": {
    "dsh": {
      "version": "1.0",
      "outputs": [],
      "operation": {},
      "retry": {},
      "cost": {},
      "error": {}
    }
  }
}
```

## Generation boundaries

A session's generation is the assembly of effective profile + capability set that
produced it. It is recorded once at `agent/created` and stored as
`session.meta.generationId`; the registry keeps the per-session current id.

```text
new session            → new generation
same session, resume   → reused
profile change         → new generation (profile-switch)
capability set change  → new generation (capability-switch)
```

`DeliveryCoordinator.deliver({ generationId })` and `InvocationLedger.claim({ generationId })`
reject a retired id explicitly (`skipped: 'stale_generation'` / `reason: 'stale_generation'`)
instead of replaying it. A missing id falls back to the process generation so pre-upgrade
sessions keep working.

Adapters get an owner identity from `AdapterHost.mount()`:

```js
host.owner // { pluginId, activationId }
```

The effect ledger records adapter `create` on mount, `release` on dispose, and
`cleanup-failed` when `stop()` throws. Delivery effects record the same owner.

## Design rules

- The core MUST NOT import QQ, NapCat, OneBot or any surface adapter.
- Surfaces inject mention/archive/presentation policy.
- Plugins declare capabilities; the core does not hardcode plugin names.
- Classification is deterministic code, not an agent decision.
- Unknown plugins are observe-only: no automatic media delivery or billing.

## Test

```bash
node --test --test-force-exit
```

## Status

`0.54.0` — per-session generation boundaries, adapter owner identities and
cleanup-failed recording on top of the extracted core.

## License

MIT License.

