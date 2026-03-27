# ANC Plugin System — Technical Specification

**Status**: Draft
**Author**: Engineer
**Issue**: ANC-24

---

## 1. Problem Statement

ANC's architecture is already extensible through YAML config (duties, routing, agents) and the typed event bus. However, adding new integrations (e.g., Slack, GitHub Actions, PagerDuty) or custom behaviors requires modifying core source files — editing `index.ts` to register handlers, adding code to `channels/`, and rebuilding.

A plugin system formalizes these extension points so that new capabilities can be added, removed, and configured without touching core code.

## 2. Design Principles

1. **Convention over configuration** — plugins are discovered by directory structure, not a central registry file.
2. **Bus-native** — plugins extend ANC the same way core hooks do: by subscribing to and emitting bus events.
3. **YAML-first config** — plugin settings live in YAML, consistent with agents/routing/duties config.
4. **No new abstractions** — reuse `TypedEventBus`, `resolveSession`, `TrackedSession`, and existing patterns.
5. **Fail-safe** — a broken plugin never crashes the gateway. Load errors are logged and skipped.
6. **Minimal API surface** — expose only what plugins need, not the entire internal API.

## 3. Plugin Structure

### 3.1 Directory Layout

```
config/plugins/
  slack/
    plugin.yaml          # metadata + configuration
    index.ts             # entry point (compiled to index.js)
  pagerduty/
    plugin.yaml
    index.ts
  custom-quality-gate/
    plugin.yaml
    index.ts
```

Plugins live under `config/plugins/<name>/`. Each plugin is a self-contained directory with a manifest (`plugin.yaml`) and an entry point (`index.ts`).

### 3.2 Plugin Manifest (`plugin.yaml`)

```yaml
name: slack-channel
version: "1.0.0"
description: "Bidirectional Slack integration for ANC"
author: "engineer"

# Which ANC capabilities this plugin needs
permissions:
  events:
    subscribe:
      - "agent:completed"
      - "agent:failed"
      - "agent:spawned"
    emit:
      - "plugin:slack:message"     # custom events must be namespaced
  apis:
    - resolveSession               # can trigger agent sessions
    - postToDiscord                 # cross-channel (optional)

# Plugin-specific configuration
config:
  slack_bot_token_env: "ANC_SLACK_BOT_TOKEN"
  channel_id_env: "ANC_SLACK_CHANNEL_ID"
  notify_on:
    - agent:completed
    - agent:failed

# Optional: contribute standing duties
duties:
  - id: slack-digest
    role: ops
    trigger:
      cron: "24h"
    issuePrefix: "slack-digest"
    prompt: |
      Summarize today's Slack activity for the team.
      Post findings to Discord via `anc group`.

# Optional: contribute routing rules
routing:
  issue_routing:
    - label: "slack-escalation"
      target: ops
```

### 3.3 Plugin Entry Point (`index.ts`)

```typescript
import type { PluginContext } from '../../../src/plugins/types.js';

export default function register(ctx: PluginContext): void | (() => void) {
  const token = process.env[ctx.config.slack_bot_token_env];
  if (!token) {
    ctx.log.warn('No Slack token configured — plugin disabled');
    return;
  }

  // Subscribe to bus events (only those declared in permissions)
  ctx.bus.on('agent:completed', async ({ role, issueKey, handoff }) => {
    await postToSlack(token, `Agent ${role} completed ${issueKey}`);
  });

  ctx.bus.on('agent:failed', async ({ role, issueKey, error }) => {
    await postToSlack(token, `Agent ${role} failed on ${issueKey}: ${error}`);
  });

  // Return optional cleanup function
  return () => {
    // disconnect Slack client, etc.
  };
}
```

## 4. Plugin API (`PluginContext`)

The `PluginContext` is the only interface between a plugin and ANC core. It provides a scoped, permission-checked subset of ANC's capabilities.

```typescript
// src/plugins/types.ts

import type { TypedEventBus, AncEvents } from '../bus.js';
import type { Logger } from '../core/logger.js';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: {
    events: {
      subscribe: string[];
      emit: string[];
    };
    apis: string[];
  };
  config: Record<string, unknown>;
  duties?: DutyConfig[];
  routing?: {
    issue_routing?: Array<{ label?: string; titlePattern?: string; target: string }>;
  };
}

export interface PluginContext {
  /** Plugin name from manifest */
  name: string;

  /** Scoped logger (prefixed with plugin name) */
  log: Logger;

  /** Scoped bus — only permitted events can be subscribed/emitted */
  bus: ScopedBus;

  /** Plugin-specific config from plugin.yaml */
  config: Record<string, unknown>;

  /** Resolve a session (spawn/resume/pipe to an agent) */
  resolveSession: typeof import('../runtime/resolve.js').resolveSession;

  /** Query active sessions */
  getSessions: () => import('../runtime/health.js').TrackedSession[];

  /** Post to Discord (if available) */
  postToDiscord?: (content: string) => Promise<boolean>;

  /** Send Telegram notification (if available) */
  sendTelegram?: (message: string) => Promise<boolean>;

  /** Plugin-local storage directory (~/.anc/plugins/<name>/) */
  storageDir: string;
}

/**
 * ScopedBus — wraps the global bus with permission enforcement.
 * Plugins can only subscribe to events listed in permissions.events.subscribe
 * and emit events listed in permissions.events.emit.
 * Custom plugin events must use the "plugin:<name>:" namespace.
 */
export interface ScopedBus {
  on<K extends keyof AncEvents & string>(
    event: K,
    handler: (data: AncEvents[K]) => void | Promise<void>
  ): () => void;

  emit(event: string, data: unknown): Promise<void>;
}
```

### 4.1 Permission Model

Plugins declare required permissions in `plugin.yaml`. The loader enforces these at runtime:

| Permission | What it gates |
|---|---|
| `events.subscribe` | Which bus events the plugin can listen to |
| `events.emit` | Which events it can emit (must be `plugin:<name>:*` namespaced) |
| `apis.resolveSession` | Can spawn/resume agent sessions |
| `apis.postToDiscord` | Can post to the Discord channel |
| `apis.sendTelegram` | Can send Telegram notifications |

**Denied permissions** result in a logged warning and a no-op, not a crash.

### 4.2 Custom Events

Plugins can define custom events using the `plugin:<name>:<event>` namespace:

```typescript
// In plugin code:
ctx.bus.emit('plugin:slack:message', { channel: '#general', text: 'hello' });

// Another plugin or core can subscribe:
bus.on('plugin:slack:message', (data) => { ... });
```

The bus type system is extended to support dynamic plugin events:

```typescript
// Addition to bus.ts
export interface AncEvents {
  // ... existing events ...

  // Plugin events — dynamic, string-keyed
  [key: `plugin:${string}:${string}`]: unknown;
}
```

## 5. Plugin Loader

### 5.1 Loading Sequence

```
anc serve
  ├── load core hooks (existing registerXHandlers)
  ├── discoverPlugins('config/plugins/')
  │     ├── for each dir: read plugin.yaml
  │     ├── validate manifest (name, version, permissions)
  │     ├── merge contributed duties → duty engine
  │     ├── merge contributed routing rules → router
  │     └── call register(ctx) with scoped context
  ├── start Discord bot
  └── start gateway
```

### 5.2 Loader Implementation

```typescript
// src/plugins/loader.ts

import { readdirSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { bus } from '../bus.js';
import { createLogger } from '../core/logger.js';
import type { PluginManifest, PluginContext } from './types.js';

const log = createLogger('plugins');
const loaded = new Map<string, { manifest: PluginManifest; cleanup?: () => void }>();

export async function loadPlugins(pluginsDir?: string): Promise<number> {
  const dir = pluginsDir ?? join(process.cwd(), 'config', 'plugins');
  if (!existsSync(dir)) return 0;

  const entries = readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory());

  let count = 0;

  for (const entry of entries) {
    const pluginDir = join(dir, entry.name);
    const manifestPath = join(pluginDir, 'plugin.yaml');

    if (!existsSync(manifestPath)) {
      log.warn(`Skipping ${entry.name}: no plugin.yaml`);
      continue;
    }

    try {
      const manifest = parseYaml(
        readFileSync(manifestPath, 'utf-8')
      ) as PluginManifest;

      if (!manifest.name || !manifest.version) {
        log.error(`Invalid manifest in ${entry.name}`);
        continue;
      }

      // Build scoped context
      const ctx = buildContext(manifest, pluginDir);

      // Load entry point
      const entryPath = join(pluginDir, 'index.js');
      if (!existsSync(entryPath)) {
        log.warn(`Skipping ${manifest.name}: no index.js`);
        continue;
      }

      const mod = await import(entryPath);
      const registerFn = mod.default ?? mod.register;

      if (typeof registerFn !== 'function') {
        log.error(`${manifest.name}: no register function exported`);
        continue;
      }

      const cleanup = registerFn(ctx);
      loaded.set(manifest.name, { manifest, cleanup });
      count++;

      log.info(`Loaded plugin: ${manifest.name}@${manifest.version}`);
    } catch (err) {
      log.error(`Failed to load plugin ${entry.name}: ${(err as Error).message}`);
      // Continue — never crash on plugin failure
    }
  }

  return count;
}

function buildContext(manifest: PluginManifest, pluginDir: string): PluginContext {
  const pluginLog = createLogger(`plugin:${manifest.name}`);
  const storageDir = join(
    process.env.HOME ?? '/tmp',
    '.anc', 'plugins', manifest.name
  );
  mkdirSync(storageDir, { recursive: true });

  const allowedSubscribe = new Set(manifest.permissions?.events?.subscribe ?? []);
  const allowedEmit = new Set(manifest.permissions?.events?.emit ?? []);
  const allowedApis = new Set(manifest.permissions?.apis ?? []);

  // Scoped bus with permission enforcement
  const scopedBus = {
    on(event: string, handler: (data: unknown) => void | Promise<void>) {
      if (!allowedSubscribe.has(event)) {
        pluginLog.warn(`Denied subscribe to "${event}" — not in permissions`);
        return () => {};
      }
      return bus.on(event as keyof import('../bus.js').AncEvents, handler as any);
    },
    async emit(event: string, data: unknown) {
      if (!event.startsWith(`plugin:${manifest.name}:`)) {
        pluginLog.warn(`Denied emit "${event}" — must use plugin:${manifest.name}: namespace`);
        return;
      }
      if (!allowedEmit.has(event)) {
        pluginLog.warn(`Denied emit "${event}" — not in permissions`);
        return;
      }
      await bus.emit(event as any, data as any);
    },
  };

  return {
    name: manifest.name,
    log: pluginLog,
    bus: scopedBus as any,
    config: manifest.config ?? {},
    storageDir,

    // Conditionally expose APIs based on permissions
    resolveSession: allowedApis.has('resolveSession')
      ? require('../runtime/resolve.js').resolveSession
      : undefined,
    getSessions: allowedApis.has('getSessions')
      ? require('../runtime/health.js').getTrackedSessions
      : (() => []),
    postToDiscord: allowedApis.has('postToDiscord')
      ? require('../channels/discord.js').postToDiscord
      : undefined,
    sendTelegram: allowedApis.has('sendTelegram')
      ? require('../channels/telegram.js').sendTelegram
      : undefined,
  };
}

export function unloadPlugins(): void {
  for (const [name, { cleanup }] of loaded) {
    try {
      cleanup?.();
    } catch (err) {
      log.error(`Error unloading ${name}: ${(err as Error).message}`);
    }
  }
  loaded.clear();
}

export function getLoadedPlugins(): string[] {
  return [...loaded.keys()];
}
```

### 5.3 Duty and Routing Merging

Plugin-contributed duties and routing rules are merged into the existing engines before handler registration:

```typescript
// In loadPlugins(), after manifest validation:
if (manifest.duties?.length) {
  mergeDuties(manifest.duties);  // appends to the duty engine's config
}
if (manifest.routing?.issue_routing?.length) {
  mergeRoutingRules(manifest.routing.issue_routing);  // appends to router
}
```

This requires minor additions to `on-duties.ts` and `routing/rules.ts`:

```typescript
// on-duties.ts addition
export function mergeDuties(extra: DutyConfig[]): void {
  duties.push(...extra.filter(d => d.id && d.role && d.prompt));
}

// routing/rules.ts addition
export function mergeRoutingRules(extra: IssueRule[]): void {
  routingConfig.issue_routing.push(...extra);
}
```

## 6. Plugin Types

### 6.1 Channel Adapters

Add a new communication channel (Slack, email, SMS, PagerDuty).

**Pattern**: Subscribe to lifecycle events → post to external service. Optionally listen to inbound events → emit to bus.

```yaml
# Slack adapter example
permissions:
  events:
    subscribe: ["agent:completed", "agent:failed", "agent:spawned"]
    emit: ["plugin:slack:message"]
  apis: []
```

### 6.2 Custom Hooks

Add new reactive behaviors to agent lifecycle events.

**Pattern**: Subscribe to events → execute custom logic (logging, metrics, webhooks).

```yaml
# Datadog metrics example
permissions:
  events:
    subscribe: ["agent:spawned", "agent:completed", "agent:failed", "system:tick"]
    emit: []
  apis: ["getSessions"]
```

### 6.3 Custom Duties

Add proactive behaviors via the duty engine — no code required, just YAML.

```yaml
# Code coverage scan — YAML-only plugin (no index.ts needed)
duties:
  - id: coverage-scan
    role: engineer
    trigger:
      cron: "72h"
    issuePrefix: "coverage"
    prompt: |
      Run test coverage and report gaps.
```

### 6.4 Routing Extensions

Add new routing rules for specialized issue handling.

```yaml
# Route security issues to a dedicated agent
routing:
  issue_routing:
    - label: "security"
      target: engineer
    - titlePattern: "\\[CVE\\]"
      target: engineer
```

### 6.5 Quality Gate Extensions

Extend the completion quality gates for specific task types.

**Pattern**: Subscribe to `agent:completed` → validate HANDOFF.md against custom criteria → emit pass/fail.

```yaml
permissions:
  events:
    subscribe: ["agent:completed"]
    emit: ["plugin:qa:gate-failed"]
  apis: ["sendTelegram"]
```

## 7. Integration with `index.ts`

The serve command adds one line:

```typescript
// In the serve command, after registerLifecycleHandlers():
const { loadPlugins } = await import('./plugins/loader.js');
const pluginCount = await loadPlugins();
if (pluginCount > 0) {
  log.info(`Loaded ${pluginCount} plugins`);
}
```

## 8. CLI: `anc plugins`

A new CLI command for plugin management:

```
anc plugins list              # list installed plugins + status
anc plugins info <name>       # show plugin manifest details
anc plugins validate <name>   # dry-run load, check permissions
```

No install/uninstall commands — plugins are managed by placing/removing directories. This keeps the system simple and git-friendly (plugins can be committed to the repo).

## 9. Plugin Lifecycle

```
                    ┌──────────────────────────────────────┐
                    │            anc serve                 │
                    └────────┬─────────────────────────────┘
                             │
                    ┌────────▼─────────────────────────────┐
                    │   1. Register core hooks              │
                    └────────┬─────────────────────────────┘
                             │
                    ┌────────▼─────────────────────────────┐
                    │   2. Discover plugins in              │
                    │      config/plugins/*/plugin.yaml     │
                    └────────┬─────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌──────▼────┐  ┌──────▼────┐
     │ Validate   │  │ Merge     │  │ Merge     │
     │ manifest   │  │ duties    │  │ routing   │
     └────────┬───┘  └──────┬────┘  └──────┬────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼─────────────────────────────┐
                    │   3. Build PluginContext               │
                    │      (scoped bus, logger, storage)     │
                    └────────┬─────────────────────────────┘
                             │
                    ┌────────▼─────────────────────────────┐
                    │   4. Call register(ctx)                │
                    │      Plugin subscribes to events       │
                    └────────┬─────────────────────────────┘
                             │
                    ┌────────▼─────────────────────────────┐
                    │   5. Gateway starts                    │
                    │      Events flow — plugins active      │
                    └────────┬─────────────────────────────┘
                             │
                    ┌────────▼─────────────────────────────┐
                    │   SIGTERM → unloadPlugins()            │
                    │   cleanup functions called             │
                    └──────────────────────────────────────┘
```

## 10. Example: Slack Channel Adapter Plugin

Complete example of a non-trivial plugin:

### `config/plugins/slack/plugin.yaml`

```yaml
name: slack-channel
version: "1.0.0"
description: "Post agent lifecycle events to Slack"
author: engineer

permissions:
  events:
    subscribe:
      - "agent:completed"
      - "agent:failed"
      - "agent:spawned"
      - "agent:suspended"
    emit:
      - "plugin:slack:posted"
  apis: []

config:
  bot_token_env: "ANC_SLACK_BOT_TOKEN"
  channel_env: "ANC_SLACK_CHANNEL_ID"
  notify_on_spawn: false
  notify_on_complete: true
  notify_on_fail: true
```

### `config/plugins/slack/index.ts`

```typescript
import type { PluginContext } from '../../../src/plugins/types.js';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

export default function register(ctx: PluginContext): () => void {
  const token = process.env[ctx.config.bot_token_env as string];
  const channel = process.env[ctx.config.channel_env as string];

  if (!token || !channel) {
    ctx.log.warn('Missing Slack credentials — disabled');
    return () => {};
  }

  // Track message count for metrics
  const statsPath = join(ctx.storageDir, 'stats.json');
  let stats = { sent: 0, errors: 0 };
  if (existsSync(statsPath)) {
    stats = JSON.parse(readFileSync(statsPath, 'utf-8'));
  }

  async function postSlack(text: string): Promise<void> {
    try {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel, text }),
      });
      if (!res.ok) throw new Error(`Slack API ${res.status}`);
      stats.sent++;
    } catch (err) {
      stats.errors++;
      ctx.log.error(`Post failed: ${(err as Error).message}`);
    }
  }

  // Subscribe to events
  const unsubs: Array<() => void> = [];

  if (ctx.config.notify_on_complete) {
    unsubs.push(ctx.bus.on('agent:completed', async ({ role, issueKey }) => {
      await postSlack(`:white_check_mark: *${role}* completed \`${issueKey}\``);
    }));
  }

  if (ctx.config.notify_on_fail) {
    unsubs.push(ctx.bus.on('agent:failed', async ({ role, issueKey, error }) => {
      await postSlack(`:x: *${role}* failed on \`${issueKey}\`: ${error}`);
    }));
  }

  if (ctx.config.notify_on_spawn) {
    unsubs.push(ctx.bus.on('agent:spawned', async ({ role, issueKey }) => {
      await postSlack(`:rocket: *${role}* started \`${issueKey}\``);
    }));
  }

  // Cleanup: unsubscribe + persist stats
  return () => {
    unsubs.forEach(fn => fn());
    writeFileSync(statsPath, JSON.stringify(stats, null, 2));
    ctx.log.info(`Shutdown — ${stats.sent} messages sent, ${stats.errors} errors`);
  };
}
```

## 11. Security Considerations

1. **No network access control** — plugins can make arbitrary HTTP calls. This is intentional for a self-hosted system. For hosted deployments, consider adding an allowlist.
2. **Bus permissions** — enforced at the `ScopedBus` level. Plugins cannot subscribe to events they didn't declare. Violations are logged.
3. **Namespace isolation** — custom events must use `plugin:<name>:` prefix. Prevents plugins from impersonating core events.
4. **Storage isolation** — each plugin gets its own `~/.anc/plugins/<name>/` directory. No access to other plugins' storage.
5. **No code injection** — plugins are loaded via dynamic `import()`, not `eval()`. They execute in the same Node.js process but cannot modify core module exports.
6. **Fail-safe loading** — all plugin operations are wrapped in try/catch. A failing plugin is logged and skipped; the gateway continues.

## 12. Future Considerations (Out of Scope for v1)

- **Hot reload**: Watch `config/plugins/` for changes, unload/reload without restarting the gateway.
- **Plugin marketplace**: A registry of community plugins (premature until the system has external users).
- **Sandboxing**: Run plugins in worker threads or separate processes for stronger isolation.
- **Plugin dependencies**: Allow plugins to declare dependencies on other plugins.
- **Plugin versioning**: Semantic versioning constraints for ANC core compatibility.
- **UI dashboard**: Web-based plugin management through the gateway.

## 13. Implementation Plan

### Phase 1 — Foundation (this issue)
- [ ] Create `src/plugins/types.ts` with `PluginManifest`, `PluginContext`, `ScopedBus`
- [ ] Create `src/plugins/loader.ts` with `loadPlugins()`, `unloadPlugins()`
- [ ] Add `plugin:*` event type to `bus.ts`
- [ ] Add `mergeDuties()` to `on-duties.ts`
- [ ] Add `mergeRoutingRules()` to `routing/rules.ts`
- [ ] Wire `loadPlugins()` into `index.ts` serve command
- [ ] Add `anc plugins list` CLI command

### Phase 2 — Reference Plugin
- [ ] Build the Slack channel adapter as the reference implementation
- [ ] Write a plugin development guide

### Phase 3 — Hardening
- [ ] Add plugin validation tests
- [ ] Add `anc plugins validate` command
- [ ] Integration tests for plugin loading, scoped bus, duty/routing merging

## 14. Decision Log

| Decision | Rationale |
|---|---|
| Directory convention over central registry | Git-friendly, no merge conflicts, easy to add/remove |
| Scoped bus over raw bus access | Prevents plugins from interfering with core event handling |
| YAML manifest over code-only config | Consistent with existing ANC config patterns |
| Same-process loading over worker threads | Simpler, lower latency, sufficient for self-hosted use |
| No install/uninstall CLI | Plugins are files — use git/filesystem operations |
| Contributed duties merged at load time | No hot-reload complexity; restart to pick up changes |
| `plugin:<name>:` event namespace | Prevents collision between plugins and with core events |
