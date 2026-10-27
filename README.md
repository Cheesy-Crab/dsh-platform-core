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

`0.41.0` — extracted from the QQ bridge so the core can run without QQ.

## License

License not declared yet.
