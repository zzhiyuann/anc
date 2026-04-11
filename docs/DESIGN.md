# ANC — Technical Design Document

## Implementation Specifications for Each System Layer

---

## 1. Monorepo Setup

### Toolchain
```
Package Manager: pnpm 9+
Build Orchestration: Turborepo
TypeScript: 5.9+ (strict mode, ES2022 target, ESM)
Node.js: 22+ (native .env loading, fetch, WebSocket)
```

### Workspace Configuration

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'packages/integrations/*'
  - 'apps/*'
```

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "dependsOn": ["^build"],
      "persistent": true,
      "cache": false
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

### Internal Package Pattern

All `packages/*` export raw TypeScript — no pre-compilation needed. Consumer apps (web, cli) handle their own bundling.

```json
// packages/core/package.json
{
  "name": "@anc/core",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./bus": "./src/bus.ts",
    "./api": "./src/api/index.ts"
  }
}
```

```json
// packages/ui/package.json
{
  "name": "@anc/ui",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./components/*": "./src/components/*.tsx"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

---

## 2. Core Engine Implementation

### 2.1 Event Bus Enhancement

Current ANC bus is solid. Enhancements needed:

```typescript
// packages/core/src/bus.ts

interface BusOptions {
  maxListeners?: number       // default: 50
  errorHandler?: (event: string, error: Error) => void
}

class TypedEventBus {
  private listeners = new Map<string, Set<Function>>()
  private middlewares: BusMiddleware[] = []

  // NEW: Middleware support for cross-cutting concerns
  use(middleware: BusMiddleware): void {
    this.middlewares.push(middleware)
  }

  async emit<K extends keyof AncEvents>(
    event: K,
    payload: AncEvents[K]
  ): Promise<void> {
    // Run middlewares (logging, metrics, WebSocket broadcast)
    for (const mw of this.middlewares) {
      await mw(event, payload)
    }

    const handlers = this.listeners.get(event as string)
    if (!handlers) return

    const results = await Promise.allSettled(
      [...handlers].map(fn => fn(payload))
    )

    for (const r of results) {
      if (r.status === 'rejected') {
        this.options.errorHandler?.(event as string, r.reason)
      }
    }
  }
}

// Middleware: WebSocket broadcast
function wsBroadcastMiddleware(wsServer: WebSocketServer): BusMiddleware {
  return (event, payload) => {
    wsServer.broadcast({ type: event, data: payload })
  }
}

// Middleware: Event logging to DB
function eventLogMiddleware(db: Database): BusMiddleware {
  return (event, payload) => {
    db.logEvent(event, payload)
  }
}
```

### 2.2 Priority Queue (Port from AgentOS)

```typescript
// packages/core/src/routing/queue.ts

export class PriorityQueue {
  private db: Database

  constructor(db: Database) {
    this.db = db
    this.ensureTable()
  }

  enqueue(item: QueueItem): void {
    this.db.run(`
      INSERT OR REPLACE INTO queue
        (issue_key, agent_role, priority, status, delay_until, metadata)
      VALUES (?, ?, ?, 'queued', ?, ?)
    `, [item.issueKey, item.agentRole, item.priority, item.delayUntil ?? 0,
        JSON.stringify(item.metadata ?? {})])
  }

  dequeue(): QueueItem | null {
    const now = Date.now()
    const row = this.db.get(`
      SELECT * FROM queue
      WHERE status = 'queued' AND delay_until <= ?
      ORDER BY priority ASC, created_at ASC
      LIMIT 1
    `, [now])

    if (!row) return null

    this.db.run(`UPDATE queue SET status = 'processing' WHERE id = ?`, [row.id])
    return this.rowToItem(row)
  }

  // Rate limit backoff: re-enqueue with exponential delay
  requeue(issueKey: string, retryCount: number): void {
    const delay = Math.min(60_000 * Math.pow(2, retryCount), 1_800_000) // max 30min
    this.db.run(`
      UPDATE queue
      SET status = 'queued', delay_until = ?, retry_count = retry_count + 1
      WHERE issue_key = ?
    `, [Date.now() + delay, issueKey])
  }

  // Cooldown support
  isInCooldown(issueKey: string): boolean {
    const row = this.db.get(`
      SELECT delay_until FROM queue WHERE issue_key = ? AND status = 'queued'
    `, [issueKey])
    return row ? row.delay_until > Date.now() : false
  }

  drain(): QueueItem | null {
    return this.dequeue()
  }

  peek(): QueueItem[] {
    return this.db.all(`
      SELECT * FROM queue WHERE status = 'queued'
      ORDER BY priority ASC, created_at ASC LIMIT 20
    `).map(this.rowToItem)
  }

  cleanup(): number {
    const cutoff = Date.now() - 3_600_000 // 1 hour
    return this.db.run(`
      DELETE FROM queue
      WHERE status IN ('completed', 'canceled') OR
        (status = 'processing' AND created_at < ?)
    `, [cutoff]).changes
  }
}
```

### 2.3 Budget Tracker (New)

```typescript
// packages/core/src/core/budget.ts

interface BudgetConfig {
  daily: { limit: number; alertAt: number }
  perAgent: Record<string, { limit: number }>
  perTask: { limit: number }
}

export class BudgetTracker {
  private db: Database
  private config: BudgetConfig
  private bus: TypedEventBus

  constructor(db: Database, config: BudgetConfig, bus: TypedEventBus) {
    this.db = db
    this.config = config
    this.bus = bus
  }

  canSpend(agentRole: string, estimatedCost: number): { allowed: boolean; reason?: string } {
    const today = this.getTodaySpend()
    const agentSpend = this.getAgentSpend(agentRole)

    if (today.total + estimatedCost > this.config.daily.limit) {
      return { allowed: false, reason: `Daily limit reached: $${today.total}/$${this.config.daily.limit}` }
    }

    const agentLimit = this.config.perAgent[agentRole]?.limit
    if (agentLimit && agentSpend + estimatedCost > agentLimit) {
      return { allowed: false, reason: `Agent ${agentRole} limit reached: $${agentSpend}/$${agentLimit}` }
    }

    if (today.total + estimatedCost > this.config.daily.alertAt) {
      this.bus.emit('system:budget-alert', {
        agent: agentRole,
        usage: today.total + estimatedCost,
        limit: this.config.daily.limit,
      })
    }

    return { allowed: true }
  }

  recordSpend(agentRole: string, issueKey: string, tokens: number, costUsd: number): void {
    const date = new Date().toISOString().split('T')[0]
    this.db.run(`
      INSERT INTO budget_log (date, agent_role, issue_key, tokens_used, cost_usd)
      VALUES (?, ?, ?, ?, ?)
    `, [date, agentRole, issueKey, tokens, costUsd])
  }

  getSummary(): BudgetSummary {
    const today = this.getTodaySpend()
    const history = this.db.all(`
      SELECT date, SUM(cost_usd) as total, SUM(tokens_used) as tokens
      FROM budget_log GROUP BY date ORDER BY date DESC LIMIT 30
    `)
    return { today, history, config: this.config }
  }
}
```

### 2.4 API Server

```typescript
// packages/core/src/api/server.ts

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'

export function createApiServer(engine: AncEngine): { http: Server; wss: WebSocketServer } {
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Set<WebSocket>()

  // WebSocket connection management
  wss.on('connection', (ws) => {
    clients.add(ws)
    ws.on('close', () => clients.delete(ws))

    // Send initial state snapshot
    ws.send(JSON.stringify({
      type: 'snapshot',
      data: {
        agents: engine.getAgentStatuses(),
        tasks: engine.getActiveTasks(),
        queue: engine.getQueueState(),
        budget: engine.getBudgetSummary(),
        health: engine.getHealthReport(),
      }
    }))
  })

  // Broadcast bus events to all connected clients
  engine.bus.use((event, payload) => {
    const msg = JSON.stringify({ type: event, data: payload, ts: Date.now() })
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msg)
      }
    }
  })

  // HTTP server with router
  const http = createServer(async (req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`)
    const path = url.pathname

    // CORS for Dashboard
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') return res.writeHead(200).end()

    try {
      // Route: existing webhook endpoint
      if (path === '/webhook') return handleWebhook(req, res, engine)

      // Route: API v1
      if (path.startsWith('/api/v1/')) {
        const apiPath = path.slice(7) // remove /api/v1
        return await routeApi(apiPath, req, res, engine)
      }

      // Route: Dashboard static files (production)
      if (path === '/' || path.startsWith('/assets/')) {
        return serveDashboard(req, res)
      }

      res.writeHead(404).end(JSON.stringify({ error: 'Not found' }))
    } catch (err) {
      res.writeHead(500).end(JSON.stringify({ error: 'Internal server error' }))
    }
  })

  // WebSocket upgrade
  http.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
    } else {
      socket.destroy()
    }
  })

  return { http, wss }
}
```

### 2.5 API Router

```typescript
// packages/core/src/api/router.ts

async function routeApi(
  path: string,
  req: IncomingMessage,
  res: ServerResponse,
  engine: AncEngine
): Promise<void> {
  const method = req.method!
  const json = (data: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  // ── Agents ──
  if (path === '/agents' && method === 'GET') {
    return json(engine.getAgentStatuses())
  }
  if (path.match(/^\/agents\/(\w+)$/) && method === 'GET') {
    const role = path.split('/')[2]
    return json(engine.getAgentDetail(role))
  }
  if (path.match(/^\/agents\/(\w+)\/start$/) && method === 'POST') {
    const role = path.split('/')[2]
    const body = await readBody(req)
    const result = await engine.startAgent(role, body.issueKey)
    return json(result)
  }
  if (path.match(/^\/agents\/(\w+)\/stop$/) && method === 'POST') {
    const role = path.split('/')[2]
    await engine.stopAgent(role)
    return json({ ok: true })
  }
  if (path.match(/^\/agents\/(\w+)\/talk$/) && method === 'POST') {
    const role = path.split('/')[2]
    const body = await readBody(req)
    await engine.talkToAgent(role, body.message)
    return json({ ok: true })
  }
  if (path.match(/^\/agents\/(\w+)\/memory$/) && method === 'GET') {
    const role = path.split('/')[2]
    return json(engine.getAgentMemory(role))
  }
  if (path.match(/^\/agents\/(\w+)\/output$/) && method === 'GET') {
    const role = path.split('/')[2]
    return json({ lines: engine.getAgentOutput(role) })
  }

  // ── Tasks ──
  if (path === '/tasks' && method === 'GET') {
    const url = new URL(req.url!, `http://${req.headers.host}`)
    const status = url.searchParams.get('status')
    const agent = url.searchParams.get('agent')
    return json(engine.getTasks({ status, agent }))
  }
  if (path === '/tasks' && method === 'POST') {
    const body = await readBody(req)
    const task = await engine.createTask(body)
    return json(task, 201)
  }
  if (path.match(/^\/tasks\/(\d+)$/) && method === 'PATCH') {
    const id = parseInt(path.split('/')[2])
    const body = await readBody(req)
    return json(await engine.updateTask(id, body))
  }
  if (path.match(/^\/tasks\/(\d+)$/) && method === 'DELETE') {
    const id = parseInt(path.split('/')[2])
    await engine.killTask(id)
    return json({ ok: true })
  }
  if (path.match(/^\/tasks\/(\d+)\/resume$/) && method === 'POST') {
    const id = parseInt(path.split('/')[2])
    return json(await engine.resumeTask(id))
  }
  if (path === '/tasks/batch' && method === 'POST') {
    const body = await readBody(req)
    return json(await engine.batchCreateTasks(body.tasks))
  }

  // ── Queue ──
  if (path === '/queue' && method === 'GET') {
    return json(engine.getQueueState())
  }
  if (path === '/queue/drain' && method === 'POST') {
    const drained = engine.drainQueue()
    return json({ drained })
  }

  // ── Memory ──
  if (path === '/memory/shared' && method === 'GET') {
    return json(engine.getSharedMemory())
  }
  if (path.match(/^\/memory\/agents\/(\w+)$/) && method === 'GET') {
    const role = path.split('/')[3]
    return json(engine.getAgentMemory(role))
  }
  if (path === '/memory/search' && method === 'GET') {
    const url = new URL(req.url!, `http://${req.headers.host}`)
    const q = url.searchParams.get('q') ?? ''
    return json(engine.searchMemory(q))
  }

  // ── Budget ──
  if (path === '/budget' && method === 'GET') {
    return json(engine.getBudgetSummary())
  }
  if (path === '/budget/history' && method === 'GET') {
    return json(engine.getBudgetHistory())
  }

  // ── System ──
  if (path === '/health' && method === 'GET') {
    return json(engine.getHealthReport())
  }
  if (path === '/health/detailed' && method === 'GET') {
    return json(engine.getDetailedHealth())
  }
  if (path === '/events' && method === 'GET') {
    const url = new URL(req.url!, `http://${req.headers.host}`)
    const limit = parseInt(url.searchParams.get('limit') ?? '50')
    const offset = parseInt(url.searchParams.get('offset') ?? '0')
    const type = url.searchParams.get('type')
    return json(engine.getEvents({ limit, offset, type }))
  }

  // ── Briefings ──
  if (path === '/briefings' && method === 'GET') {
    return json(engine.getBriefings())
  }
  if (path === '/briefings/latest' && method === 'GET') {
    return json(engine.getLatestBriefing())
  }
  if (path.match(/^\/briefings\/(\d+)\/acknowledge$/) && method === 'POST') {
    const id = parseInt(path.split('/')[2])
    await engine.acknowledgeBriefing(id)
    return json({ ok: true })
  }

  // ── Circuit Breakers ──
  if (path === '/circuit-breakers' && method === 'GET') {
    return json(engine.getCircuitBreakerStates())
  }
  if (path.match(/^\/circuit-breakers\/(.+)\/reset$/) && method === 'POST') {
    const issueKey = path.split('/')[2]
    engine.resetCircuitBreaker(issueKey)
    return json({ ok: true })
  }

  // ── Config ──
  if (path === '/config' && method === 'GET') {
    return json(engine.getConfig())
  }
  if (path === '/config' && method === 'PATCH') {
    const body = await readBody(req)
    return json(await engine.updateConfig(body))
  }

  json({ error: 'Not found' }, 404)
}
```

---

## 3. Dashboard Implementation

### 3.1 Project Setup

```bash
# apps/web/
npx create-next-app@latest --typescript --tailwind --app --src-dir
npx shadcn@latest init
npx shadcn@latest add button card badge input dialog command-dialog
  dropdown-menu table tabs toast progress separator scroll-area
```

### 3.2 Real-Time Data Layer

```typescript
// packages/ui/src/hooks/useWebSocket.ts

export function useAncWebSocket() {
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3848/ws`)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => {
      setConnected(false)
      // Auto-reconnect with backoff
      setTimeout(() => connect(), 2000)
    }

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)

      // Optimistic cache updates via TanStack Query
      switch (msg.type) {
        case 'agent:status':
          queryClient.setQueryData(['agents'], (old: Agent[]) =>
            old?.map(a => a.role === msg.data.role ? { ...a, ...msg.data } : a)
          )
          break
        case 'task:updated':
          queryClient.invalidateQueries({ queryKey: ['tasks'] })
          break
        case 'queue:changed':
          queryClient.setQueryData(['queue'], msg.data)
          break
        case 'budget:updated':
          queryClient.setQueryData(['budget'], msg.data)
          break
        case 'briefing:new':
          queryClient.invalidateQueries({ queryKey: ['briefings'] })
          // Toast notification
          toast({ title: msg.data.title, description: msg.data.type })
          break
        case 'agent:output':
          // Append to terminal buffer
          queryClient.setQueryData(
            ['agent-output', msg.data.role],
            (old: string[]) => [...(old ?? []), ...msg.data.lines].slice(-500)
          )
          break
        case 'snapshot':
          // Initial state load
          queryClient.setQueryData(['agents'], msg.data.agents)
          queryClient.setQueryData(['tasks'], msg.data.tasks)
          queryClient.setQueryData(['queue'], msg.data.queue)
          queryClient.setQueryData(['budget'], msg.data.budget)
          break
      }
    }

    return () => ws.close()
  }, [])

  return { connected, ws: wsRef.current }
}
```

### 3.3 API Client

```typescript
// packages/ui/src/hooks/useApi.ts

const API_BASE = 'http://localhost:3848/api/v1'

export const api = {
  // Agents
  agents: {
    list: () => fetch(`${API_BASE}/agents`).then(r => r.json()),
    get: (role: string) => fetch(`${API_BASE}/agents/${role}`).then(r => r.json()),
    start: (role: string, issueKey: string) =>
      fetch(`${API_BASE}/agents/${role}/start`, {
        method: 'POST', body: JSON.stringify({ issueKey }),
        headers: { 'Content-Type': 'application/json' },
      }).then(r => r.json()),
    stop: (role: string) =>
      fetch(`${API_BASE}/agents/${role}/stop`, { method: 'POST' }).then(r => r.json()),
    talk: (role: string, message: string) =>
      fetch(`${API_BASE}/agents/${role}/talk`, {
        method: 'POST', body: JSON.stringify({ message }),
        headers: { 'Content-Type': 'application/json' },
      }).then(r => r.json()),
    memory: (role: string) => fetch(`${API_BASE}/agents/memory/${role}`).then(r => r.json()),
    output: (role: string) => fetch(`${API_BASE}/agents/${role}/output`).then(r => r.json()),
  },

  // Tasks
  tasks: {
    list: (params?: { status?: string; agent?: string }) => {
      const qs = new URLSearchParams(params as Record<string, string>).toString()
      return fetch(`${API_BASE}/tasks?${qs}`).then(r => r.json())
    },
    create: (task: CreateTaskInput) =>
      fetch(`${API_BASE}/tasks`, {
        method: 'POST', body: JSON.stringify(task),
        headers: { 'Content-Type': 'application/json' },
      }).then(r => r.json()),
    update: (id: number, updates: Partial<Task>) =>
      fetch(`${API_BASE}/tasks/${id}`, {
        method: 'PATCH', body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      }).then(r => r.json()),
    kill: (id: number) => fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' }).then(r => r.json()),
    resume: (id: number) => fetch(`${API_BASE}/tasks/${id}/resume`, { method: 'POST' }).then(r => r.json()),
    batch: (tasks: CreateTaskInput[]) =>
      fetch(`${API_BASE}/tasks/batch`, {
        method: 'POST', body: JSON.stringify({ tasks }),
        headers: { 'Content-Type': 'application/json' },
      }).then(r => r.json()),
  },

  // Queue, Budget, Health, Briefings, Memory...
  queue: {
    get: () => fetch(`${API_BASE}/queue`).then(r => r.json()),
    drain: () => fetch(`${API_BASE}/queue/drain`, { method: 'POST' }).then(r => r.json()),
  },
  budget: {
    get: () => fetch(`${API_BASE}/budget`).then(r => r.json()),
    history: () => fetch(`${API_BASE}/budget/history`).then(r => r.json()),
  },
  health: {
    get: () => fetch(`${API_BASE}/health/detailed`).then(r => r.json()),
  },
  briefings: {
    list: () => fetch(`${API_BASE}/briefings`).then(r => r.json()),
    latest: () => fetch(`${API_BASE}/briefings/latest`).then(r => r.json()),
    acknowledge: (id: number) =>
      fetch(`${API_BASE}/briefings/${id}/acknowledge`, { method: 'POST' }).then(r => r.json()),
  },
  memory: {
    shared: () => fetch(`${API_BASE}/memory/shared`).then(r => r.json()),
    agent: (role: string) => fetch(`${API_BASE}/memory/agents/${role}`).then(r => r.json()),
    search: (q: string) => fetch(`${API_BASE}/memory/search?q=${encodeURIComponent(q)}`).then(r => r.json()),
  },
}
```

### 3.4 Page Component Structure

```
apps/web/app/
├── layout.tsx              # Root layout: sidebar nav + header
├── page.tsx                # Command Center (dashboard home)
├── tasks/
│   ├── page.tsx            # Task board (Kanban + List + Timeline views)
│   └── [id]/page.tsx       # Task detail
├── agents/
│   ├── page.tsx            # Agent list (team overview)
│   └── [role]/page.tsx     # Agent profile + live terminal
├── memory/
│   └── page.tsx            # Memory explorer
├── settings/
│   ├── page.tsx            # General settings
│   ├── agents/page.tsx     # Agent config editor
│   ├── routing/page.tsx    # Routing rules editor
│   ├── duties/page.tsx     # Standing duties editor
│   ├── budget/page.tsx     # Budget settings
│   └── integrations/page.tsx  # Integration management
└── api/                    # Optional: API routes if needed for SSR
```

### 3.5 Design System Tokens

```typescript
// packages/ui/src/theme.ts

export const theme = {
  colors: {
    // Base
    bg: { primary: '#0a0a0a', secondary: '#141414', tertiary: '#1e1e1e' },
    text: { primary: '#e5e5e5', secondary: '#a3a3a3', muted: '#525252' },
    border: { default: '#262626', hover: '#404040' },

    // Status
    status: {
      active: '#22c55e',     // green — running
      idle: '#a3a3a3',       // gray — idle
      queued: '#eab308',     // yellow — waiting
      failed: '#ef4444',     // red — error
      completed: '#3b82f6',  // blue — done
      suspended: '#8b5cf6',  // purple — paused
    },

    // Agent identity colors
    agent: {
      engineer: '#3b82f6',
      strategist: '#8b5cf6',
      ops: '#f97316',
      'ceo-office': '#eab308',
    },

    // Accents
    accent: '#3b82f6',       // Primary action blue
    warning: '#eab308',
    danger: '#ef4444',
    success: '#22c55e',
  },

  fonts: {
    sans: 'Inter, system-ui, sans-serif',
    mono: 'JetBrains Mono, Menlo, monospace',
  },

  spacing: {
    page: '24px',
    card: '16px',
    section: '32px',
  },

  radii: {
    sm: '6px',
    md: '8px',
    lg: '12px',
  },
}
```

---

## 4. Integration Refactoring

### 4.1 Linear Adapter (Comment-Based Sync)

```typescript
// packages/integrations/linear/src/sync.ts

export class LinearSync {
  private client: LinearClient  // System token (for reads)
  private agentClients: Map<string, LinearClient>  // Per-agent OAuth tokens

  // ANC → Linear: Post comment as agent
  async postAgentComment(
    issueId: string,
    agentRole: string,
    body: string
  ): Promise<void> {
    const client = this.agentClients.get(agentRole)
    if (!client) return
    await client.createComment({ issueId, body })
  }

  // ANC → Linear: Update issue status
  async syncStatus(issueId: string, status: string): Promise<void> {
    const stateMap: Record<string, string> = {
      'todo': 'Todo',
      'running': 'In Progress',
      'review': 'In Review',
      'done': 'Done',
    }
    const targetState = stateMap[status]
    if (!targetState) return

    const states = await this.client.workflowStates({ filter: { name: { eq: targetState } } })
    const state = states.nodes[0]
    if (state) {
      await this.client.updateIssue(issueId, { stateId: state.id })
    }
  }

  // ANC → Linear: Create sub-issue
  async createSubIssue(
    parentId: string,
    title: string,
    description: string,
    agentRole?: string
  ): Promise<string> {
    const client = agentRole ? this.agentClients.get(agentRole) ?? this.client : this.client
    const result = await client.createIssue({
      title,
      description,
      parentId,
      teamId: this.teamId,
    })
    return result.issue!.id
  }

  // Linear → ANC: Process incoming webhook
  handleWebhook(payload: WebhookPayload): BusEvent | null {
    // Only handle Issue and Comment events
    // AgentSession events are IGNORED (no longer needed)

    if (payload.type === 'Issue' && payload.action === 'create') {
      return { event: 'webhook:issue.created', data: { issue: payload.data, source: 'linear' } }
    }
    if (payload.type === 'Comment' && payload.action === 'create') {
      // Skip comments from our own agents (prevent echo)
      if (this.isOwnAgent(payload.data.userId)) return null
      return { event: 'webhook:comment.created', data: { comment: payload.data, source: 'linear' } }
    }
    if (payload.type === 'Issue' && payload.action === 'update') {
      return { event: 'webhook:issue.updated', data: { issue: payload.data, changes: payload.updatedFrom } }
    }

    return null
  }
}
```

### 4.2 Event Flow: Dashboard Task Creation

```
User clicks "New Task" in Dashboard
  → POST /api/v1/tasks { title, description, agent?, priority? }
  → core creates task record in SQLite
  → bus.emit('webhook:issue.created', { issue, source: 'dashboard' })
  → on-issue hook: route → resolve → spawn
  → If Linear connected: LinearSync.createIssue() (background, non-blocking)
  → WebSocket broadcasts task:created to Dashboard
  → Dashboard updates in real-time
```

### 4.3 Event Flow: Linear Issue Creation

```
User creates issue in Linear
  → Linear fires webhook to /webhook
  → Gateway verifies signature
  → LinearSync.handleWebhook() → bus event
  → bus.emit('webhook:issue.created', { issue, source: 'linear' })
  → Same on-issue hook processes it
  → Agent spawns, works, completes
  → LinearSync.postAgentComment() + LinearSync.syncStatus()
  → Linear issue updated with agent's work
```

Both paths converge through the same event bus and hooks. The source is tracked but processing is identical.

---

## 5. Data Flow Diagrams

### Task Lifecycle

```
                     ┌──── Dashboard ────┐
                     │  POST /tasks      │
                     └────────┬──────────┘
                              │
                     ┌────────┴──────────┐
                     │  webhook:issue     │
         ┌──────────│  .created          │──────────┐
         │          └────────────────────┘          │
         │                                          │
    Linear Source                             Dashboard Source
    (has Linear ID)                          (no Linear ID yet)
         │                                          │
         └──────────────┬───────────────────────────┘
                        │
                   ┌────┴─────┐
                   │  Router  │ — match rules, assign agent
                   └────┬─────┘
                        │
                   ┌────┴──────┐
                   │  Resolve  │ — convergence gate
                   └────┬──────┘
                        │
              ┌─────────┼─────────┐
              │         │         │
         Has active  Has idle   No session
         session     session    
              │         │         │
         Pipe msg   --continue  Spawn fresh
              │         │         │
              └─────────┼─────────┘
                        │
                   ┌────┴──────┐
                   │  Running  │ — tmux session active
                   └────┬──────┘
                        │
                   Monitor (30s tick)
                        │
              ┌─────────┼─────────┐
              │         │         │
          HANDOFF.md  BLOCKED.md  tmux dead
          detected    detected    no artifact
              │         │         │
         Complete   Elicitate    Fail
              │         │         │
              └─────────┼─────────┘
                        │
                ┌───────┴────────┐
                │ Post-Complete  │
                │ - Parse Actions│
                │ - Status sync  │
                │ - Dispatches   │
                │ - RETRO process│
                │ - Memory save  │
                │ - Linear sync  │
                └────────────────┘
```

---

## 6. Testing Strategy

### Unit Tests (vitest)
- Event bus: emit, subscribe, error isolation
- Queue: enqueue, dequeue, priority, cooldown, backoff
- Router: rule matching, default fallback, concurrency check
- Circuit breaker: trip, reset, backoff calculation
- Budget: canSpend, recordSpend, alerts
- Memory: load, score, sort, frontmatter parsing
- Actions parser: all HANDOFF.md formats

### Integration Tests
- API endpoints: request/response validation
- WebSocket: connect, subscribe, receive events
- Linear sync: webhook → bus event → task creation
- End-to-end: create task → agent spawns → completes → HANDOFF processed

### E2E Tests (Playwright, Phase 3)
- Dashboard load → see agent statuses
- Create task → see it in Kanban
- Click agent → see live terminal
- Cmd+K → execute command

---

## 7. Performance Targets

| Metric | Target |
|--------|--------|
| API response (GET) | < 50ms |
| API response (POST) | < 100ms |
| WebSocket event delivery | < 10ms |
| Dashboard initial load | < 1s |
| Dashboard real-time update | < 100ms perceived |
| Memory search (keyword) | < 200ms |
| Webhook acknowledgment | < 1s (HTTP 200) |
| Queue drain cycle | < 5s |
| Health check cycle | 30s interval |
| Max concurrent agent sessions | 15 |
| SQLite DB size (6 months) | < 100MB |
