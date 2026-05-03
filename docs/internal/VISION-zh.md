# ANC — Agent Native Company

## 完整系统愿景与技术规划

> 一个人 + AI 团队 = 一家完整运转的公司。
> CEO 做战略决策，AI 高管自主执行，系统自愈运转。

---

## 目录

1. [核心理念](#1-核心理念)
2. [系统分层架构](#2-系统分层架构)
3. [Layer 0 — 核心引擎](#3-layer-0--核心引擎)
4. [Layer 1 — Agent 系统](#4-layer-1--agent-系统)
5. [Layer 2 — API 层](#5-layer-2--api-层)
6. [Layer 3 — 原生应用](#6-layer-3--原生应用)
7. [Layer 4 — 集成层](#7-layer-4--集成层)
8. [Agent Runtime 适配](#8-agent-runtime-适配)
9. [CEO Office Agent](#9-ceo-office-agent)
10. [记忆系统](#10-记忆系统)
11. [自愈与监控](#11-自愈与监控)
12. [5 分钟上手](#12-5-分钟上手)
13. [项目结构](#13-项目结构)
14. [路线图](#14-路线图)
15. [竞争优势](#15-竞争优势)

---

## 1. 核心理念

**ANC 不是一个 AI 工具。它是一个 AI 公司操作系统。**

| 传统模式 | ANC 模式 |
|----------|---------|
| 人用 AI 完成任务 | AI 团队自主运转，人做决策 |
| 每次 session 从零开始 | Agent 有持久记忆，越用越强 |
| 手动分配工作 | 智能路由 + 自动 dispatch |
| 出了问题人来修 | CEO Office Agent 自动处理 |
| 一个工具 | 一个运转中的公司 |

### 三个不可妥协的原则

1. **Agent 是团队成员，不是工具调用** — 有名字、有记忆、有专长、有成长
2. **CEO 只做高杠杆决策** — 系统处理一切可自动化的事务
3. **零新工具学习成本** — Dashboard 足够直觉，5 分钟上手

---

## 2. 系统分层架构

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3 — Dashboard GUI (Web + Desktop)                │
│  CEO 的眼睛和手：实时监控、任务管理、记忆浏览、配置      │
├─────────────────────────────────────────────────────────┤
│  Layer 2 — API Layer (REST + WebSocket)                 │
│  所有 UI 和集成的统一接口，real-time event streaming     │
├─────────────────────────────────────────────────────────┤
│  Layer 1 — Agent System                                 │
│  Agent 注册、人设组装、记忆、SDK、CEO Office             │
├─────────────────────────────────────────────────────────┤
│  Layer 0 — Core Engine                                  │
│  Event Bus · Queue · Router · Runtime · Circuit Breaker │
│  Budget · DB · Health · Resolve Gate                    │
├──────────┬──────────────┬──────────────┬────────────────┤
│  Linear  │   Discord    │   Telegram   │   GitHub       │
│  (sync)  │   (bridge)   │   (notify)   │   (PR/review)  │
└──────────┴──────────────┴──────────────┴────────────────┘
```

**关键设计决策：ANC 是一个完整的独立平台，不是任何工具的附属品。**

### 这不是一个 Dashboard。这是一个完整的公司操作系统。

ANC 自带完整的项目管理能力（任务、看板、时间线、优先级），自带原生 Mac 和 iOS 应用，自带完整的 agent 管理和通信界面。**用户不需要 Linear、不需要 Jira、不需要任何其他工具。**

Linear/GitHub/Discord 等外部工具是可选的双向同步集成，与核心功能完全解耦。

### 与 Multica 的根本区别

Multica 是用 Web 做的一个「还行」的 PM 工具。ANC 要做的是：
- **原生 Mac 应用**（Swift + AppKit/SwiftUI）— 像 Linear 一样丝滑，不是套了壳的 Web
- **iOS 应用**（SwiftUI）— CEO 手机上随时看公司状态
- **Agent 有记忆** — Multica 的 agent 每次从零开始，我们的 agent 越用越强
- **多 Runtime** — 不绑定单一 AI。Claude Code、Claw Code、Aider、Gemini CLI 全支持
- **CEO Office Agent** — 自动管理其他 agent，业界首创

### Agent Runtime 多元化

不绑定单一 coding agent。支持多种 runtime backend：

| Runtime | 级别 | 调用方式 | 优势 |
|---------|------|---------|------|
| **Claude Code** | S-tier (主力) | `claude -p --output-format stream-json` | 最强推理、session 续接、budget 控制 |
| **Claw Code** | B-tier (开源替代) | `claw prompt "task"` | 开源 Rust 实现、可自部署 |
| **Aider** | A-tier (多模型) | `aider --message "task" --yes` | 支持 100+ 模型、极易脚本化 |
| **Gemini CLI** | A-tier (免费层) | `gemini -p "task" --output-format json` | 免费额度、1M context |
| **OpenHands** | A-tier (自定义) | Python SDK + REST API | 自定义 agent 逻辑、K8s 扩展 |
| **Custom** | 可扩展 | Adapter 接口 | 任何 CLI 工具都可以接入 |

每个 agent 角色可以配置使用不同的 runtime。Engineer 用 Claude Code（最强推理），简单任务用 Gemini CLI（免费），研究任务用 Aider + GPT-5（多模型切换）。

---

## 3. Layer 0 — 核心引擎

核心引擎是整个系统的心脏。所有上层功能都通过 Event Bus 解耦。

### 3.1 Event Bus (`bus.ts`)

```typescript
interface AncEvents {
  // Webhook 事件（来自集成层）
  'webhook:issue.created': { issue: Issue; source: 'linear' | 'dashboard' }
  'webhook:issue.updated': { issue: Issue; changes: Record<string, unknown> }
  'webhook:comment.created': { comment: Comment; source: string }

  // Agent 生命周期
  'agent:spawned': { role: string; issueKey: string; tmuxSession: string }
  'agent:idle': { role: string; issueKey: string; reason: string }
  'agent:completed': { role: string; issueKey: string; handoff: Handoff }
  'agent:failed': { role: string; issueKey: string; error: string }
  'agent:stuck': { role: string; issueKey: string; duration: number }
  'agent:rate-limited': { role: string; retryAfter: number }

  // 系统事件
  'system:tick': { timestamp: number }
  'system:health': { status: HealthReport }
  'system:budget-alert': { agent: string; usage: number; limit: number }

  // Queue 事件
  'queue:enqueued': { issueKey: string; priority: number }
  'queue:drained': { issueKey: string; agent: string }

  // CEO Office 事件
  'ceo:briefing': { type: 'daily' | 'alert' | 'strategic'; content: string }
  'ceo:intervention-needed': { issue: string; reason: string }
}
```

所有 handler 通过 `Promise.allSettled()` 并发执行，单个 handler 失败不影响其他。

### 3.2 Priority Queue（从 AgentOS 移植 + 增强）

```typescript
interface QueueItem {
  issueKey: string
  priority: number        // 1 = CEO-assigned (最高), 2 = urgent, 3 = normal, 5 = duty
  agentRole?: string      // 指定 agent 或让 router 决定
  source: 'ceo' | 'dispatch' | 'auto' | 'duty'
  delayUntil?: number     // 延迟执行（rate limit backoff）
  retryCount: number
  maxRetries: number      // 默认 3
  createdAt: number
  metadata?: Record<string, unknown>
}
```

**SQLite 持久化**（从 AgentOS 移植）：
- 服务重启后 queue 不丢失
- `dequeue()` 尊重 `delayUntil`（backoff 场景）
- 自动清理 > 1 小时的 stale items
- 按 `(status, priority ASC, createdAt ASC)` 索引

**优先级模型**：
| Priority | Source | 描述 |
|----------|--------|------|
| 1 | CEO 手动分配 | 最高优先，永不被 evict |
| 2 | Agent dispatch (urgent) | 阻塞性依赖 |
| 3 | Agent dispatch (normal) | 标准子任务 |
| 4 | Auto-route | 自动检测的待办 |
| 5 | Standing duty | 定期巡检 |

### 3.3 Router（YAML 声明式 + 智能匹配）

保留 ANC 的 YAML 声明式路由，增加 AgentOS 的并发控制：

```yaml
# config/routing.yaml
rules:
  - match:
      labels: ["bug", "fix"]
    route: engineer
    priority: 2

  - match:
      labels: ["strategy", "research"]
    route: strategist

  - match:
      project: "Infrastructure"
    route: ops

  - match:
      title: "^\\[AUTO\\]"
    route: ops
    priority: 4

defaults:
  route: engineer
  priority: 3

concurrency:
  engineer: 5
  strategist: 3
  ops: 3
  ceo-office: 1    # CEO Office 永远只跑一个
  global_max: 15
```

### 3.4 Resolve Gate（ANC 独创 — 保留）

**所有触发路径汇聚到一个函数**。无论 webhook、手动 spawn、queue drain、resume——都经过 `resolve()`：

```
任何触发 → resolve()
  1. Circuit breaker 检查
  2. 已有 active session? → pipe message
  3. 已有 idle session? → --continue 重新激活
  4. 已有 suspended session? → resume with checkpoint
  5. 无 session + 有容量? → spawn fresh
  6. 无 session + 无容量? → evict or queue
```

消灭了整整一类 bug：重复 spawn、竞态条件、容量溢出。

### 3.5 Runtime（Session 生命周期）

**三态模型**（ANC 独创 — 保留）：

```
Active ──完成──→ Idle ──超时/evict──→ Suspended
  ↑                  │                    │
  └──── resume ──────┘                    │
  └──── resume with checkpoint ───────────┘
```

- **Active**: tmux 存活，Claude 运行中，占用容量
- **Idle**: tmux 退出，workspace 保留，`--continue` 可零成本续接
- **Suspended**: workspace + SUSPEND.md 保留，需要 checkpoint context 才能恢复

**Session 恢复**（服务重启后）：
- 扫描所有存活的 tmux session
- 匹配 `anc-{role}-{issueKey}` 命名模式
- 重建内存中的 session tracking
- 自动恢复监控

### 3.6 Circuit Breaker（ANC — 保留）

Per-issue 失败追踪：
- 指数退避：60s → 120s → 240s → ... → 30min cap
- 3 次连续失败后 trip
- trip 后该 issue 不再自动 spawn，需要 CEO 手动 reset 或 CEO Office Agent 介入
- ~60 行代码，简洁有效

### 3.7 Budget Tracker（从 AgentOS 移植）

```typescript
interface BudgetConfig {
  daily: { limit: number; alertAt: number }    // e.g. $50/day, alert at $40
  perAgent: Record<string, { limit: number }>   // e.g. engineer: $20
  perTask: { limit: number }                    // e.g. $5/task max
}

interface BudgetState {
  today: { spent: number; taskCount: number }
  perAgent: Record<string, { spent: number; taskCount: number }>
  history: Array<{ date: string; total: number }>
}
```

- spawn 前检查：`canSpend(agent, estimatedCost) → boolean`
- 超 alertAt 时 → `system:budget-alert` 事件 → CEO Office Agent 处理
- 超 limit → 拒绝 spawn，通知 CEO
- 数据持久化到 SQLite，Dashboard 可查

### 3.8 Database（SQLite WAL mode）

```sql
-- 任务追踪（AgentOS 的 attempts 表 + ANC 的 tasks 表合并）
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  issue_key TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued|running|completed|failed|killed|suspended
  priority INTEGER DEFAULT 3,
  source TEXT DEFAULT 'manual',           -- ceo|dispatch|auto|duty
  tmux_session TEXT,
  linear_session_id TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  cost_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  error TEXT,
  handoff_summary TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- 事件日志（完整审计轨迹）
CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,                     -- agent:spawned, agent:completed, etc.
  issue_key TEXT,
  agent_role TEXT,
  payload TEXT,                           -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Queue（持久化优先级队列）
CREATE TABLE queue (
  id INTEGER PRIMARY KEY,
  issue_key TEXT NOT NULL UNIQUE,
  agent_role TEXT,
  priority INTEGER DEFAULT 3,
  status TEXT DEFAULT 'queued',           -- queued|processing|completed|canceled
  delay_until INTEGER DEFAULT 0,
  retry_count INTEGER DEFAULT 0,
  metadata TEXT,                          -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Budget（每日用量追踪）
CREATE TABLE budget_log (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,                     -- YYYY-MM-DD
  agent_role TEXT NOT NULL,
  issue_key TEXT,
  tokens_used INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- CEO Briefings（CEO Office Agent 生成的报告）
CREATE TABLE briefings (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,                     -- daily|alert|strategic|incident
  title TEXT NOT NULL,
  content TEXT NOT NULL,                  -- Markdown
  agent_role TEXT DEFAULT 'ceo-office',
  acknowledged INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

---

## 4. Layer 1 — Agent 系统

### 4.1 Agent 注册（YAML 驱动 — ANC 已有，增强）

```yaml
# config/agents.yaml
agents:
  engineer:
    name: "Engineer"
    avatar: "👨‍💻"
    model: claude-code
    maxConcurrency: 5
    dutySlots: 1
    base: personas/base.md
    role: personas/roles/engineer.md
    protocols:
      - personas/protocols/completion.md
      - personas/protocols/communication.md
      - personas/protocols/memory.md
      - personas/protocols/retrospective.md
    capabilities:
      - code
      - architecture
      - testing
      - code-review

  strategist:
    name: "Strategist"
    avatar: "📊"
    model: claude-code
    maxConcurrency: 3
    dutySlots: 1
    base: personas/base.md
    role: personas/roles/strategist.md
    protocols:
      - personas/protocols/completion.md
      - personas/protocols/communication.md
      - personas/protocols/memory.md
    capabilities:
      - product
      - strategy
      - research
      - content

  ops:
    name: "Ops"
    avatar: "🔧"
    model: claude-code
    maxConcurrency: 3
    dutySlots: 1
    base: personas/base.md
    role: personas/roles/ops.md
    protocols:
      - personas/protocols/completion.md
      - personas/protocols/communication.md
      - personas/protocols/memory.md
    capabilities:
      - monitoring
      - triage
      - deploy
      - infrastructure

  ceo-office:
    name: "CEO Office"
    avatar: "🏛️"
    model: claude-code
    maxConcurrency: 1
    dutySlots: 1
    base: personas/base.md
    role: personas/roles/ceo-office.md
    protocols:
      - personas/protocols/completion.md
      - personas/protocols/communication.md
      - personas/protocols/memory.md
    capabilities:
      - monitoring
      - coordination
      - briefing
      - triage
    # CEO Office 有特殊权限
    permissions:
      canRestartAgents: true
      canOverridePriority: true
      canManageBudget: true
      canDismissAlerts: true
```

### 4.2 Composable Persona（ANC 独创 — 保留并增强）

人设组装流程：

```
Identity Header (name, role, critical rules)
  + base.md (基础操作协议)
  + roles/{role}.md (角色专长)
  + protocols/*.md (行为协议: completion, memory, retro, communication)
  + agent memory files (最多 20 条，按 importance 排序)
  + shared memory (跨 agent 共享知识)
  + recent retrospectives (最近 3 次)
  + SDK reference (可用的 anc 命令)
  = 完整的 CLAUDE.md
```

**增强点**（从 AgentOS 移植）：
- cross-agent shared memory（AgentOS 的 `shared-memory/`）
- retrospective loading（AgentOS 的最近 3 次 retro）
- worker persona（一次性任务的轻量人设，不加载全部 memory）
- memory 按 importance 排序，重要的优先进 context

### 4.3 Agent SDK（ANC 已有 — 保留并增强）

Agent 可用的 CLI 命令（通过 `anc-sdk`）：

```bash
# Linear 操作（通过 agent 自己的 OAuth token）
anc comment <issue> "message"        # 在 issue 下评论
anc read-issue <issue>               # 读取 issue 详情
anc create-sub <parent> "title" "desc"  # 创建子 issue
anc search "query"                   # 搜索 issues
anc set-status <issue> <status>      # 更改状态

# 公司沟通
anc dispatch <role> <issue> "context"  # 派遣另一个 agent
anc group "message"                  # 发送到 Discord 团队频道
anc plan-announce "plan summary"     # 公布计划

# 记忆操作（新增）
anc remember "key insight"           # 快速写入 memory
anc recall "topic"                   # 搜索相关 memory
anc share-knowledge "topic" "content" # 写入 shared memory

# 系统信息（新增）
anc who-is-on <issue>                # 查看谁在处理这个 issue
anc team-status                      # 查看团队状态
anc budget-check                     # 查看预算余量
```

### 4.4 Batch Operations（从 AgentOS 移植）

```bash
# CLI
anc batch ANC-1 ANC-2 ANC-3         # 顺序 spawn 多个 issue
anc batch --parallel ANC-1 ANC-2     # 并行 spawn（有容量时）

# Dashboard
# 多选 tasks → 右键 → "Assign to Agent" → 选择 agent 或 auto-route
```

---

## 5. Layer 2 — API 层

Dashboard 和所有外部集成通过统一 API 层访问核心引擎。

### 5.1 REST API

```
基础路径: http://localhost:3848/api/v1

── Agents ──
GET    /agents                    # 列出所有 agent + 当前状态
GET    /agents/:role              # agent 详情（memory count, session history）
POST   /agents/:role/start        # 启动 agent 处理指定 issue
POST   /agents/:role/stop         # 优雅停止
POST   /agents/:role/talk         # 向运行中的 agent 发送消息
GET    /agents/:role/memory       # 列出 agent 的所有 memory 文件
GET    /agents/:role/memory/:file # 读取某个 memory 文件内容
GET    /agents/:role/output       # 获取当前 tmux session 输出（最后 N 行）

── Tasks ──
GET    /tasks                     # 列出所有任务（支持 ?status=running&agent=engineer）
POST   /tasks                     # 创建新任务（等同于 Dashboard 创建 issue）
GET    /tasks/:id                 # 任务详情
PATCH  /tasks/:id                 # 更新任务（优先级、agent、状态）
DELETE /tasks/:id                 # 终止任务
POST   /tasks/:id/resume          # 恢复失败任务
POST   /tasks/batch               # 批量创建/分配任务

── Queue ──
GET    /queue                     # 当前队列内容
POST   /queue/drain               # 手动触发 queue drain
DELETE /queue/:issueKey           # 从队列中移除

── Memory ──
GET    /memory/shared             # 列出共享 memory
GET    /memory/agents/:role       # 某 agent 的 memory 列表
GET    /memory/search?q=keyword   # 搜索所有 memory

── Budget ──
GET    /budget                    # 当前预算状态
GET    /budget/history            # 历史费用数据（图表用）
PATCH  /budget                    # 更新预算配置

── System ──
GET    /health                    # 系统健康状态
GET    /health/detailed           # 分组件健康状态
GET    /events                    # 事件日志（支持分页 + 过滤）
GET    /config                    # 当前配置（agents, routing, duties）
PATCH  /config                    # 更新配置

── Briefings ──
GET    /briefings                 # CEO Office 的所有报告
GET    /briefings/latest          # 最新报告
POST   /briefings/:id/acknowledge # 标记已阅

── Circuit Breaker ──
GET    /circuit-breakers          # 所有 breaker 状态
POST   /circuit-breakers/:issueKey/reset  # 手动重置
```

### 5.2 WebSocket（实时事件流）

```
连接: ws://localhost:3848/ws

── 客户端 → 服务器 ──
{ "type": "subscribe", "channels": ["agents", "tasks", "system"] }
{ "type": "unsubscribe", "channels": ["system"] }

── 服务器 → 客户端 ──
{ "type": "agent:status", "data": { "role": "engineer", "status": "active", "issueKey": "ANC-42" } }
{ "type": "task:updated", "data": { "id": 7, "status": "completed", "handoff": "..." } }
{ "type": "agent:output", "data": { "role": "engineer", "lines": ["Building...", "Tests passing"] } }
{ "type": "queue:changed", "data": { "length": 3, "next": "ANC-45" } }
{ "type": "budget:updated", "data": { "daily": { "spent": 12.5, "limit": 50 } } }
{ "type": "briefing:new", "data": { "type": "alert", "title": "Engineer stuck on ANC-42" } }
{ "type": "system:health", "data": { "uptime": 86400, "agents": { ... } } }
```

WebSocket 直接订阅 Event Bus — 所有内部事件自动推送到 Dashboard。

### 5.3 认证

**本地模式**（默认）：无认证，localhost only
**远程模式**：Bearer token（`anc setup` 时生成，存 `~/.anc/api-token`）
**未来**：OAuth2 for multi-user / team 场景

---

## 6. Layer 3 — 原生应用

**ANC 不是一个 web app 套壳。它是原生的。**

### 6.1 应用矩阵

| 平台 | 技术 | 定位 | 优先级 |
|------|------|------|--------|
| **macOS** | Swift + SwiftUI + AppKit | 主力应用，像 Linear macOS 一样丝滑 | Phase 2 (MVP) |
| **iOS** | Swift + SwiftUI | CEO 移动端，随时掌控公司 | Phase 3 |
| **Web** | Next.js (SSR) | 通用访问、分享链接、公开 dashboard | Phase 2 (同步) |
| **CLI** | TypeScript (Node.js) | 开发者和 power user、脚本化 | Phase 1 (已有) |

**Mac 应用是核心**。Web 是辅助。不是反过来。

### 6.2 Mac App 架构

```
ANC.app (macOS)
├── SwiftUI Views          # UI 层
│   ├── CommandCenter      # 首页仪表盘
│   ├── TaskBoard          # 完整项目管理（Kanban/List/Timeline）
│   ├── AgentProfiles      # Agent 详情 + 实时终端
│   ├── MemoryExplorer     # 知识库浏览
│   ├── InboxView          # CEO Office briefings + 通知
│   └── SettingsView       # 配置管理
│
├── Core (Swift Package)   # 业务逻辑
│   ├── ANCClient          # REST + WebSocket 连接 ANC Core
│   ├── TaskStore           # 本地 task 缓存 (SwiftData)
│   ├── RealtimeEngine      # WebSocket 事件处理
│   └── NotificationMgr    # macOS 通知中心集成
│
├── Native Features
│   ├── Menu Bar Widget     # 状态栏：agent 状态一览
│   ├── Spotlight Plugin    # Spotlight 搜索 tasks/agents
│   ├── Widgets (WidgetKit) # 桌面 widget：KPI 卡片
│   ├── Shortcuts           # Siri Shortcuts 集成
│   └── TouchBar            # Touch Bar 快捷操作
│
└── Keyboard-First
    ├── ⌘K Command Palette  # 全局命令面板
    ├── ⌘N New Task         # 快速创建任务
    ├── ⌘1-5 View Switch    # 视图切换
    └── vim-style navigation # j/k 导航
```

### 6.3 设计语言

**"CEO Cockpit"** — 像 Linear 的克制 + 像 Things 的愉悦 + 像 Raycast 的速度。

```
视觉原则：
- 原生 macOS 美学：vibrancy、sidebar、NSToolbar
- 深色主题优先（跟随系统可选）
- 信息密度高但不拥挤 — 每个数据点都有意义
- 动效原生：macOS spring animations，不是 web 的 CSS transition
- 字体：SF Pro (UI) + SF Mono (code/data) — 100% 原生
- 0 像素 web 味道：没有 hamburger menu、没有 loading spinner、没有 skeleton screen

交互原则：
- ⌘K 全局命令面板（搜索任务、执行命令、切换视图、@agent talk）
- 键盘优先，触控板友好
- 右键上下文菜单（原生 NSMenu）
- 拖拽分配（Task → Agent sidebar）
- 实时数据，永不需要手动刷新
- Menu Bar widget 常驻：🟢3 🟡2 🔴0 📊$12
```

### 6.4 iOS App

```
ANC Mobile (iOS)
├── 主屏
│   ├── Company Pulse       # 简化版 Command Center
│   ├── Notifications       # CEO Briefings + Alerts
│   └── Quick Actions       # 审批、分配、回复
│
├── 功能
│   ├── Task List           # 简化版任务列表（approve/reject/reassign）
│   ├── Agent Status        # Agent 当前状态
│   ├── Chat with Agent     # 对话式交互（像 iMessage）
│   └── Briefing Reader     # CEO Office 报告阅读
│
├── Widgets (WidgetKit)
│   ├── Small: Agent count (🟢3 🟡1)
│   ├── Medium: Top 3 active tasks
│   └── Large: Full company pulse
│
└── 通知
    ├── Critical: 系统故障、budget 超限
    ├── Normal: Agent 完成任务、briefing 到达
    └── Silent: 后台 sync 状态更新
```

**iOS 不是 Mac 的缩小版。** iOS 针对 CEO 的移动决策场景优化：
- 收到通知 → 30 秒内审批或分配
- 在飞机上 → 阅读 CEO Office 的战略分析
- 等咖啡时 → 快速浏览今日完成情况

### 6.3 页面规划

#### 页面 1: Command Center（首页/仪表盘）

**CEO 打开 Dashboard 的第一个画面 — 10 秒了解公司全貌。**

```
┌─────────────────────────────────────────────────────────┐
│  ANC — Command Center                    ⌘K  🔔 3  ⚙️  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │ Running  │ │  Idle   │ │ Queued  │ │ Today$  │      │
│  │    3     │ │    1    │ │    5    │ │ $12.50  │      │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘      │
│                                                         │
│  ┌─── Agent Status ──────────────────────────────┐     │
│  │ 👨‍💻 Engineer    ● Active   ANC-42 "Fix auth"  │     │
│  │ 📊 Strategist  ● Active   ANC-38 "Research"   │     │
│  │ 🔧 Ops         ○ Idle     —                    │     │
│  │ 🏛️ CEO Office  ● Active   Monitoring...        │     │
│  └───────────────────────────────────────────────┘     │
│                                                         │
│  ┌─── Activity Feed ─────────────┐ ┌─── Briefing ────┐│
│  │ 2m ago  Engineer completed     │ │ CEO Office:     ││
│  │         ANC-41                 │ │                 ││
│  │ 5m ago  Strategist spawned     │ │ 3 tasks done    ││
│  │         on ANC-38              │ │ today. Engineer  ││
│  │ 12m ago Engineer dispatched    │ │ blocked on ANC-  ││
│  │         ANC-43 to Strategist   │ │ 42 (rate limit) ││
│  │ 30m ago Ops completed pulse    │ │ Recommend: bump  ││
│  │         check — all healthy    │ │ priority.       ││
│  └────────────────────────────────┘ └─────────────────┘│
│                                                         │
│  ┌─── Cost Trend (7 days) ───────────────────────┐     │
│  │  $50 ┤                                         │     │
│  │  $25 ┤    ╱╲    ╱╲                            │     │
│  │   $0 ┤╱╲╱  ╲╱╱  ╲╱╲                          │     │
│  │      Mon  Tue  Wed  Thu  Fri  Sat  Sun         │     │
│  └───────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

**组件明细：**

- **顶部卡片**：4 个 KPI — Running / Idle / Queued / Daily Cost
- **Agent Status**：实时状态列表，点击展开看 terminal output
- **Activity Feed**：时间线视图，按事件类型着色
- **CEO Briefing**：CEO Office Agent 最新的分析/建议，可 acknowledge
- **Cost Trend**：7 天费用趋势图

#### 页面 2: Tasks（任务板）

**所有任务的全景视图，CEO 在这里分配工作。**

```
视图切换: [Kanban] [List] [Timeline]

Kanban 列:
  Backlog → Todo → In Progress → In Review → Done

每个 Task 卡片:
  ┌─────────────────────────┐
  │ ANC-42: Fix auth flow   │
  │ 👨‍💻 Engineer  ● Running  │
  │ Priority: ██░░░  P2     │
  │ Cost: $1.20  ⏱ 15m      │
  │ ▓▓▓▓▓▓▓▓░░ 80%          │
  └─────────────────────────┘

操作:
- 拖拽卡片到不同列 → 更新状态
- 拖拽到 Agent avatar → 分配
- 右键 → Resume / Kill / Re-assign / Change Priority
- 双击 → 展开详情面板（description, comments, handoff, output）
- Cmd+N → 新建 task（自动 sync 到 Linear）
- 多选 → Batch assign
```

#### 页面 3: Agents（团队管理）

**每个 Agent 的 profile，像看团队成员一样。**

```
┌─ Agent Profile ─────────────────────────────────────────┐
│                                                          │
│  👨‍💻 Engineer                                            │
│  Status: ● Active on ANC-42                              │
│  Model: claude-code | Sessions today: 7 | Cost: $8.50    │
│                                                          │
│  ┌── Current Session ──────────────────────────────┐     │
│  │  Terminal Output (live stream):                  │     │
│  │  > Reading src/auth/middleware.ts...             │     │
│  │  > Found the bug: missing token refresh logic   │     │
│  │  > Writing fix...                               │     │
│  │  > Running tests... 42/42 passed ✓              │     │
│  │                                         [Talk]  │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌── Memory (23 files) ────────────────────────────┐     │
│  │  📄 architecture.md — Core auth flow decisions  │     │
│  │  📄 debugging-tips.md — Common gotchas          │     │
│  │  📄 tech-debt.md — Items to address later       │     │
│  │  [View All] [Search]                            │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌── Session History ──────────────────────────────┐     │
│  │  ANC-41  ✓ Done     15m  $1.20  "Add tests"    │     │
│  │  ANC-39  ✓ Done     32m  $2.80  "Refactor DB"  │     │
│  │  ANC-37  ✗ Failed   5m   $0.40  "Deploy fix"   │     │
│  │  [View All]                                     │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌── Performance ──────────────────────────────────┐     │
│  │  Success Rate: 92%  |  Avg Time: 18m            │     │
│  │  Total Tasks: 47    |  Total Cost: $142          │     │
│  │  Memory Growth: +12 files this week              │     │
│  └─────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────┘
```

**功能：**
- **Live Terminal**: 实时流式显示 agent 的 tmux 输出（WebSocket）
- **Talk**: 直接向 running agent 发送消息（inject into tmux）
- **Memory Browser**: 浏览/搜索 agent 的所有知识文件
- **Session History**: 完整的工作历史，可点击查看 HANDOFF
- **Performance Stats**: 成功率、平均耗时、费用统计

#### 页面 4: Memory Explorer（知识库）

**可视化整个团队的累积知识。**

```
┌─── Memory Explorer ─────────────────────────────────────┐
│                                                          │
│  Filter: [All Agents ▼] [All Types ▼] [Search: _____]   │
│                                                          │
│  ┌── Shared Knowledge (12 files) ──────────────────┐     │
│  │  🌐 architecture-decisions.md         Updated 2d│     │
│  │  🌐 api-conventions.md                Updated 5d│     │
│  │  🌐 postmortem-ANC-37.md             Updated 1w│     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌── By Agent ─────────────────────────────────────┐     │
│  │  👨‍💻 Engineer (23 files)                        │     │
│  │    📄 auth-flow.md          importance: high    │     │
│  │    📄 testing-patterns.md   importance: medium  │     │
│  │    📄 ...                                       │     │
│  │                                                 │     │
│  │  📊 Strategist (15 files)                       │     │
│  │    📄 product-vision.md     importance: high    │     │
│  │    📄 competitor-analysis.md importance: medium  │     │
│  │    📄 ...                                       │     │
│  └─────────────────────────────────────────────────┘     │
│                                                          │
│  ┌── Knowledge Timeline ──────────────────────────┐      │
│  │  ●━━━━━●━━━━●━━●━━━●━━━━━━━●━━●━━●━━━━━━●━●   │      │
│  │  Mar 1        Mar 15       Apr 1       Apr 10  │      │
│  │  8 files      12 files     18 files    50 files│      │
│  └────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────┘
```

**功能：**
- 全文搜索所有 memory 文件
- 按 agent / type / importance / date 过滤
- Knowledge Timeline 展示团队知识增长
- 点击文件 → 侧边预览（Markdown rendered）
- 编辑 → 直接修改 memory 文件（CEO 可以给 agent 注入知识）

#### 页面 5: Settings（配置中心）

```
Tabs: [General] [Agents] [Routing] [Duties] [Budget] [Integrations]

General:
- Execution host (localhost / SSH remote)
- Workspace path
- API port
- Dashboard theme

Agents:
- Monaco Editor 编辑 agents.yaml
- 实时预览 persona 组装结果
- 添加/删除 agent role

Routing:
- 可视化路由规则编辑器
- 拖拽 label → agent 映射
- 测试路由："这个 issue 会路由到哪个 agent？"

Duties:
- Standing duties 编辑器
- Cron 表达式可视化
- 启用/禁用某个 duty

Budget:
- Daily / per-agent / per-task 限额设置
- Alert 阈值

Integrations:
- Linear: API key, team, sync settings
- Discord: Bot token, channel mapping
- Telegram: Bot token, CEO chat ID
- GitHub: Token, repo mapping
```

#### 全局组件

**Command Palette (Cmd+K)**
```
> assign ANC-42 to engineer
> stop engineer
> create task "Fix login bug"
> show engineer memory
> budget status
> reset circuit breaker ANC-37
```

**Notification Center (🔔)**
- CEO Office briefings（需要 acknowledge）
- Budget alerts
- Agent failures
- Circuit breaker trips
- Queue full warnings

---

## 7. Layer 4 — 集成层

### 7.1 Linear（降级为双向 sync）

**不再使用 AgentSession API。改用 Comment + Status sync。**

```
Linear → ANC:
  - Issue created/updated → webhook → bus event → task created/updated
  - Comment created → webhook → if @agent → route to agent
  - Status changed → webhook → update local task state

ANC → Linear:
  - Task completed → update Linear issue status
  - Agent comment → create Linear comment (as agent OAuth identity)
  - Sub-issue created → create Linear sub-issue
  - Agent dispatched → add comment "@agent picking this up"
```

保留 per-agent OAuth token 的身份区分（agent 以自己名义发言），但不再创建/管理 AgentSession。

**效果**：
- "Did not respond" 问题彻底消失
- "Working..." 徽章不再出现（改为 Dashboard 上显示）
- Agent 活动通过 comment 反映在 Linear 里（对 Linear 用户仍然可见）
- 100% 稳定，不受 Linear API 限制

### 7.2 Discord（保留 ANC 现有）

- 双向 bridge：Discord message ↔ Linear issue
- Agent 以自己的身份回复（webhook avatar）
- 团队频道用于 group announcements
- CEO Office Agent 在 Discord 发布 briefings

### 7.3 Telegram（通知）

- CEO 专属通知渠道
- Critical alerts（budget 超限、agent 连续失败、系统异常）
- Daily briefing summary
- Rate limit hit → 通知 CEO + 暂停

### 7.4 GitHub（未来）

- PR tracking：agent 创建的 PR 关联到 task
- Code review：分配 review 给 Engineer agent
- CI status：build 失败自动创建 fix task

---

## 8. Agent Runtime 适配

### 8.1 Runtime Adapter 接口

```typescript
interface RuntimeAdapter {
  name: string                    // "claude-code" | "claw-code" | "aider" | "gemini"
  
  // 能力声明
  capabilities: {
    sessionResume: boolean        // 支持 --continue？
    structuredOutput: boolean     // JSON 输出？
    budgetControl: boolean        // 内置费用限制？
    streaming: boolean            // 流式输出？
    turnLimit: boolean            // 限制步数？
  }
  
  // 生命周期
  spawn(opts: SpawnOptions): Promise<SpawnResult>
  resume(sessionId: string, message?: string): Promise<void>
  pipe(sessionId: string, message: string): Promise<void>
  kill(sessionId: string): void
  isAlive(sessionId: string): boolean
  captureOutput(sessionId: string, lines?: number): string[]
  
  // 成本估算
  estimateCost(taskComplexity: 'low' | 'medium' | 'high'): number
}
```

### 8.2 Claude Code Adapter（主力）

```typescript
class ClaudeCodeAdapter implements RuntimeAdapter {
  name = 'claude-code'
  capabilities = {
    sessionResume: true,      // --continue, --resume
    structuredOutput: true,   // --output-format stream-json
    budgetControl: true,      // --max-budget-usd
    streaming: true,          // stream-json
    turnLimit: true,          // --max-turns
  }
  
  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    const cmd = [
      'claude',
      '-p', opts.prompt,
      '--permission-mode', 'auto',
      '--output-format', 'stream-json',
      '--max-turns', String(opts.maxTurns ?? 50),
      '--max-budget-usd', String(opts.maxBudget ?? 5),
    ]
    if (opts.sessionName) cmd.push('--name', opts.sessionName)
    if (opts.systemPrompt) cmd.push('--system-prompt', opts.systemPrompt)
    
    return this.launchInTmux(opts.tmuxSession, cmd, opts.workspace)
  }
  
  async resume(sessionId: string): Promise<void> {
    const cmd = ['claude', '--continue', '--permission-mode', 'auto']
    return this.launchInTmux(sessionId, cmd)
  }
}
```

### 8.3 Aider Adapter（多模型）

```typescript
class AiderAdapter implements RuntimeAdapter {
  name = 'aider'
  capabilities = {
    sessionResume: false,     // 无原生 resume
    structuredOutput: false,  // 纯文本输出
    budgetControl: false,
    streaming: false,
    turnLimit: false,
  }
  
  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    const cmd = [
      'aider',
      '--message', opts.prompt,
      '--yes',                // 自动确认
      '--auto-commits',
      '--model', opts.model ?? 'sonnet',
    ]
    if (opts.files?.length) cmd.push(...opts.files)
    
    return this.launchInTmux(opts.tmuxSession, cmd, opts.workspace)
  }
}
```

### 8.4 Gemini CLI Adapter（免费层）

```typescript
class GeminiAdapter implements RuntimeAdapter {
  name = 'gemini'
  capabilities = {
    sessionResume: true,
    structuredOutput: true,   // --output-format json
    budgetControl: false,     // 免费层无需
    streaming: true,
    turnLimit: false,
  }
  
  async spawn(opts: SpawnOptions): Promise<SpawnResult> {
    const cmd = [
      'gemini',
      '-p', opts.prompt,
      '--output-format', 'stream-json',
    ]
    return this.launchInTmux(opts.tmuxSession, cmd, opts.workspace)
  }
}
```

### 8.5 Runtime 路由策略

```yaml
# config/agents.yaml — 每个 agent 可以指定首选 + 备选 runtime
agents:
  engineer:
    name: "Engineer"
    runtime:
      primary: claude-code      # 首选：最强推理
      fallback: aider           # 备选：Claude 不可用时
    maxBudgetPerTask: 5.00

  strategist:
    name: "Strategist"
    runtime:
      primary: claude-code
      fallback: gemini          # 研究任务用免费层也行
    maxBudgetPerTask: 3.00

  ops:
    name: "Ops"  
    runtime:
      primary: gemini           # Ops 巡检用免费层即可
      fallback: aider
    maxBudgetPerTask: 1.00
```

**智能降级**：当 Claude Code 触发 rate limit → 自动切换到 fallback runtime → 通知 CEO Office。

---

## 9. CEO Office Agent

**这是 ANC 最独特的设计 — 一个 meta-agent，管理其他 agent。**

### 角色定义

```markdown
# CEO Office (Chief of Staff)

你是 CEO 的幕僚长。你的任务不是写代码或做产品，而是：
1. 监控公司运转状况
2. 检测并处理 agent 故障
3. 协调跨 agent 工作
4. 给 CEO 提供简报和战略分析
5. 处理杂务，让 CEO 专注于高杠杆决策
```

### 职责明细

#### 8.1 健康监控（持续）
```yaml
# duties.yaml
- id: health-monitor
  role: ceo-office
  trigger:
    cron: "30m"
  prompt: |
    [Health Check] 检查公司运转状况:
    1. `anc team-status` — 所有 agent 状态
    2. 检查 circuit breaker 是否有 tripped
    3. 检查 queue depth — 是否有积压
    4. 检查 budget — 是否接近限额
    5. 检查 idle agents — 是否有活可干

    处理策略:
    - Agent stuck > 30 min → 尝试发消息 unblock，不行就 kill + retry
    - Rate limited → 调整 queue 优先级，暂停低优先任务
    - Queue 积压 > 10 → 通知 CEO 需要扩容或调整优先级
    - Budget > 80% → 暂停非关键 duty，通知 CEO
    - Idle agent + pending tasks → 手动分配
```

#### 8.2 Daily Briefing（每日）
```yaml
- id: daily-briefing
  role: ceo-office
  trigger:
    cron: "24h"
  prompt: |
    [Daily Briefing] 生成今日公司运营报告:

    1. 今日完成的任务（按 agent 分组）
    2. 正在进行的任务和预计完成时间
    3. 遇到的阻塞和已采取的措施
    4. Budget 使用情况 vs 昨日
    5. Agent 表现分析（谁效率高、谁频繁失败）
    6. 建议：明天 CEO 应该关注什么

    输出为结构化 briefing，发送到 Dashboard + Discord。
```

#### 8.3 故障处理（事件触发）
```yaml
- id: agent-recovery
  role: ceo-office
  trigger:
    event: "agent:failed"
  prompt: |
    [Agent Recovery] {role} failed on {issueKey}. Error: {error}

    快速诊断:
    1. Rate limit? → queue with backoff, no escalation
    2. Auth expired? → 尝试 refresh, 不行就通知 CEO
    3. Code bug? → Create fix issue for Engineer
    4. Repeated failure (3+)? → Trip circuit breaker, notify CEO
    5. 所有其他 → Log to shared memory, retry once
```

#### 8.4 战略分析（周度）
```yaml
- id: weekly-strategy
  role: ceo-office
  trigger:
    cron: "168h"
  prompt: |
    [Weekly Strategy Review] 本周公司运营分析:

    1. 完成任务统计（total, per-agent, per-category）
    2. 效率趋势（本周 vs 上周）
    3. 费用趋势和 ROI 分析
    4. Agent 知识增长（new memory files, retro insights）
    5. 瓶颈识别（什么类型的任务耗时最长？哪个 agent 最常失败？）
    6. 建议：下周公司应该优先做什么

    输出详细报告到 Dashboard briefings。
```

#### 8.5 协调工作
- 检测到两个 agent 在做重复工作 → 通知并协调
- 检测到上游依赖完成 → 自动 unblock 下游任务
- 检测到 agent 创建了过多子任务 → 提醒简化

---

## 9. 记忆系统

### 9.1 存储架构

```
~/.anc/
├── memory/
│   ├── shared/                    # 全团队共享知识
│   │   ├── architecture-decisions.md
│   │   ├── api-conventions.md
│   │   └── postmortem-ANC-37.md
│   │
│   └── agents/
│       ├── engineer/              # Engineer 私有知识
│       │   ├── MEMORY.md          # 索引
│       │   ├── auth-flow.md
│       │   ├── testing-patterns.md
│       │   └── retrospectives/
│       │       ├── 2026-04-10.md
│       │       └── 2026-04-09.md
│       │
│       ├── strategist/
│       ├── ops/
│       └── ceo-office/
```

### 9.2 Memory 文件格式（带 frontmatter）

```markdown
---
type: architecture-decision
importance: high
created: 2026-04-10
agent: engineer
tags: [auth, security, middleware]
---

## Auth Middleware Architecture

We chose JWT + refresh token approach because...

### Key Decision
- Access token: 15 min expiry
- Refresh token: 7 days, rotated on use
- Storage: httpOnly cookie (not localStorage)

### Why Not Session-Based
Session storage doesn't scale horizontally without Redis...
```

### 9.3 Memory 加载策略

```typescript
function loadMemoryForAgent(role: string, taskContext?: string): string[] {
  const memories: ScoredMemory[] = []

  // 1. Agent 自己的 memory（全部加载，按 importance 排序）
  const agentMemories = readMemoryFiles(`~/.anc/memory/agents/${role}/`)
  for (const m of agentMemories) {
    memories.push({
      content: m.content,
      score: calculateScore(m, taskContext),
    })
  }

  // 2. Shared memory（全部加载）
  const sharedMemories = readMemoryFiles('~/.anc/memory/shared/')
  for (const m of sharedMemories) {
    memories.push({
      content: m.content,
      score: calculateScore(m, taskContext) * 0.8, // slight discount
    })
  }

  // 3. Recent retrospectives（最近 3 个）
  const retros = readRecentRetros(`~/.anc/memory/agents/${role}/retrospectives/`, 3)

  // 4. 按 score 排序，取 top 20（防止 token 爆炸）
  memories.sort((a, b) => b.score - a.score)
  return memories.slice(0, 20).map(m => m.content).concat(retros)
}

function calculateScore(memory: Memory, taskContext?: string): number {
  const importance = memory.frontmatter.importance === 'high' ? 1.0
    : memory.frontmatter.importance === 'medium' ? 0.6 : 0.3

  const ageDays = (Date.now() - memory.frontmatter.created) / 86400000
  const recency = Math.pow(0.5, ageDays / 30)  // 30 天半衰期

  const relevance = taskContext
    ? keywordOverlap(memory.tags, taskContext) // 简单关键词匹配
    : 0.5

  return importance * 0.4 + recency * 0.3 + relevance * 0.3
}
```

### 9.4 未来增强（v0.3+）

- **向量搜索**：SQLite + pgvector extension，对 memory 做 embedding
- **衰减清理**：自动归档 score < 0.1 的 memory
- **知识图谱**：entity extraction，关系可视化（Memory Explorer 页面）
- **Memory consolidation**：定期合并重复/相似的 memory

**v0.1 不需要这些。** 文件系统 + frontmatter + keyword matching 已经足够好（Letta benchmark 验证）。

---

## 10. 自愈与监控

### 10.1 自动恢复矩阵

| 故障 | 检测方式 | 自动处理 | CEO 通知 |
|------|---------|---------|---------|
| Agent 超时（tmux 死了） | health tick 检测 | retry 一次 | 第 2 次失败通知 |
| Rate limit | tmux 输出检测 | queue + backoff | 连续 3 次通知 |
| Auth token 过期 | API 返回 401 | 尝试 refresh | refresh 失败通知 |
| Circuit breaker tripped | breaker 状态 | 停止该 issue | 通知 CEO 决定 |
| Budget 超限 | spawn 前检查 | 拒绝 spawn | 通知 + 建议 |
| Queue 积压 > 10 | tick 检测 | 优先处理高优 | 通知 + 建议 |
| 服务崩溃重启 | launchd restart | 恢复 tmux sessions | 无（静默恢复） |
| Orphaned tmux sessions | tick 检测 | 清理并标记失败 | 仅记录 |
| 磁盘空间不足 | health check | 清理旧 workspace | 通知 |

### 10.2 健康检查端点

```json
GET /api/v1/health/detailed
{
  "status": "healthy",
  "uptime": 86400,
  "components": {
    "database": { "status": "healthy", "size": "12MB" },
    "eventBus": { "status": "healthy", "handlers": 23 },
    "queue": { "status": "healthy", "depth": 3 },
    "agents": {
      "engineer": { "status": "active", "sessions": 2 },
      "strategist": { "status": "idle" },
      "ops": { "status": "active", "sessions": 1 },
      "ceo-office": { "status": "active", "sessions": 1 }
    },
    "circuitBreakers": { "tripped": 0 },
    "budget": { "daily": { "spent": 12.5, "limit": 50, "pct": 25 } },
    "integrations": {
      "linear": { "status": "connected", "lastSync": "2m ago" },
      "discord": { "status": "connected" },
      "telegram": { "status": "connected" }
    }
  }
}
```

---

## 11. 5 分钟上手

### 用户旅程

```
Step 1: 安装（30 秒）
$ npm install -g anc

Step 2: 初始化（2 分钟）
$ anc setup
  ┌─ ANC Setup ────────────────────────────┐
  │                                         │
  │  Welcome! Let's set up your AI company. │
  │                                         │
  │  ┌─ Execution ──────────────────────┐   │
  │  │ Where should agents run?         │   │
  │  │ ● This machine (localhost)       │   │
  │  │ ○ Remote via SSH                 │   │
  │  └─────────────────────────────────┘   │
  │                                         │
  │  ┌─ Integrations (optional) ────────┐   │
  │  │ □ Linear (sync issues/comments)  │   │
  │  │ □ Discord (team communication)   │   │
  │  │ □ Telegram (CEO notifications)   │   │
  │  └─────────────────────────────────┘   │
  │                                         │
  │  ┌─ Agent Team ─────────────────────┐   │
  │  │ Use default team? (Engineer,     │   │
  │  │ Strategist, Ops, CEO Office)     │   │
  │  │ ● Yes, start with defaults       │   │
  │  │ ○ Customize roles                │   │
  │  └─────────────────────────────────┘   │
  │                                         │
  │  [Continue →]                           │
  └─────────────────────────────────────────┘

Step 3: 启动（10 秒）
$ anc serve
  ANC v1.0.0 — AI Company OS
  ✓ Event Bus initialized
  ✓ Database ready
  ✓ 4 agents loaded (Engineer, Strategist, Ops, CEO Office)
  ✓ Gateway listening on :3848
  ✓ Dashboard: http://localhost:3848

  → Open http://localhost:3848 to start

Step 4: 打开 Dashboard（10 秒）
  → 浏览器打开，看到 Command Center
  → CEO Office Agent 自动启动，开始监控

Step 5: 创建第一个任务（1 分钟）
  → Dashboard: Cmd+N → "Fix the login bug in auth.ts"
  → 选择 Agent: Engineer（或 auto-route）
  → Engineer 自动 spawn，开始工作
  → 实时看到 terminal 输出
  → 完成后看到 HANDOFF summary
```

### 零集成也能用

ANC 不需要 Linear、Discord 或 Telegram 就能运转。
最小配置 = ANC + Dashboard + 本地 Claude Code/Codex。
集成是锦上添花，不是必需。

---

## 12. 项目结构

```
anc/
├── packages/
│   ├── core/                    # ANC 核心引擎
│   │   ├── src/
│   │   │   ├── bus.ts           # Event Bus
│   │   │   ├── agents/          # Registry, Persona, Memory, SDK
│   │   │   ├── runtime/         # Resolve, Health, Runner, Workspace, Circuit Breaker
│   │   │   ├── routing/         # Router, Queue, Rules
│   │   │   ├── hooks/           # Event handlers
│   │   │   ├── core/            # DB, Logger, Budget
│   │   │   └── api/             # REST + WebSocket server
│   │   ├── config/              # Default config templates
│   │   ├── personas/            # Default persona fragments
│   │   └── package.json
│   │
│   ├── sdk-swift/               # Swift SDK (shared Mac + iOS)
│   │   ├── Sources/ANCKit/
│   │   │   ├── ANCClient.swift       # REST + WebSocket client
│   │   │   ├── Models/               # Codable data models
│   │   │   ├── Realtime/             # WebSocket event engine
│   │   │   └── Store/                # Observable state store
│   │   └── Package.swift
│   │
│   └── integrations/
│       ├── linear/              # Linear sync adapter
│       ├── discord/             # Discord bridge
│       ├── github/              # GitHub PR/review sync
│       └── telegram/            # Telegram notifications
│
├── apps/
│   ├── macos/                   # 原生 Mac 应用 (Swift + SwiftUI)
│   │   ├── ANC/
│   │   │   ├── Views/CommandCenter/
│   │   │   ├── Views/TaskBoard/      # 完整项目管理
│   │   │   ├── Views/AgentProfiles/
│   │   │   ├── Views/MemoryExplorer/
│   │   │   ├── Views/Inbox/
│   │   │   ├── Views/Settings/
│   │   │   ├── MenuBar/             # 状态栏 widget
│   │   │   └── Widgets/             # 桌面 widgets
│   │   └── ANC.xcodeproj
│   │
│   ├── ios/                     # iOS 应用 (SwiftUI)
│   │   ├── ANCMobile/
│   │   │   ├── Views/               # 移动优化视图
│   │   │   └── Widgets/             # iOS widgets
│   │   └── ANCMobile.xcodeproj
│   │
│   ├── web/                     # Web 版 (Next.js — 通用访问)
│   │   ├── app/
│   │   │   ├── page.tsx         # Command Center
│   │   │   ├── tasks/           # Task Board
│   │   │   ├── agents/          # Agent Profiles
│   │   │   └── memory/          # Memory Explorer
│   │   └── package.json
│   │
│   └── cli/                     # CLI 工具 (TypeScript)
│       ├── src/commands/
│       └── package.json
│
├── docs/                        # 文档站
├── landing/                     # Landing page
├── turbo.json                   # Turborepo config
├── pnpm-workspace.yaml
├── VISION.md                    # This file
└── README.md
```

---

## 13. 路线图

### Phase 1 — Core Stabilization ✅ DONE
- [x] Port AgentOS 全部功能到 core（queue, budget, persona, batch）
- [x] Linear 降级为 comment-based sync（移除 AgentSession 依赖）
- [x] API layer（REST + WebSocket + 完整 CRUD）
- [x] Fix 所�� Linear 交互 bugs（-231 行 AgentSession 代码删除）
- [x] CEO Office Agent persona + duties
- [x] 116 tests passing
- [x] README 重写 + GitHub CI

### Phase 2 — Web Dashboard + Native Mac App（并行开发）

**两个前端，同一个 API 后端。**

Web Dashboard：
- [ ] 连接真实 API（去掉 mock data）
- [ ] WebSocket 实时连通
- [ ] Command Center + Tasks + Agents + Memory 四个核心页面

Native Mac App（Swift + SwiftUI）：
- [ ] ANCKit Swift Package：REST client + WebSocket + @Observable store
- [ ] macOS App：Sidebar + Command Center（第一个可见画面）
- [ ] macOS App：Task Board（Kanban + List）
- [ ] macOS App：Agent Detail + live terminal
- [ ] macOS App：Menu Bar widget（常驻状态栏）
- [ ] macOS App：⌘K command palette + 键盘导航
- [ ] Agent live terminal output streaming（WebSocket → 终端视图）

### Phase 3 — Polish & Ship
- [ ] macOS App：Memory Explorer + Settings + CEO Briefing
- [ ] macOS App：桌面 Widgets (WidgetKit)
- [ ] Web 功能对齐 Mac app
- [ ] Landing page（含 Mac app 截图）
- [ ] Documentation site
- [ ] Demo 视频
- [ ] GitHub 公开发布 + HN / ProductHunt

### Phase 4 — Growth（持续）
- [ ] iOS App MVP（SwiftUI，共享 ANCKit）
- [ ] Mac App Store 上架
- [ ] Multi-runtime adapters（Aider, Gemini）
- [ ] Memory 向量搜索 + knowledge graph
- [ ] Multi-user / team 支持
- [ ] Cloud hosted 版本
- [ ] Agent marketplace（社区贡献 persona + duty 模板）
- [ ] Plugin system（自定义 hook + integration + runtime adapter）
- [ ] App Store 上架（Mac + iOS）

---

## 14. 竞争优势

### vs Multica（7.6K stars）

| 维度 | ANC | Multica |
|------|-----|---------|
| **应用形态** | 原生 Mac + iOS app | Web + Electron（套壳） |
| **Agent 记忆** | 持久化 + retrospective + shared memory | 无 |
| **学习能力** | Agent 越用越强 | 每次从零开始 |
| **Agent Runtime** | 多 runtime（Claude, Aider, Gemini, Claw Code） | 仅支持少数几个 |
| **CEO 体验** | CEO Office Agent 主动汇报 + 自愈 + iOS 移动端 | 被动查看 Web 页面 |
| **架构** | Event-driven, composable personas | Monolithic Go + Next.js |
| **上手速度** | npm install + setup wizard, 5 min | Docker + PostgreSQL, 30 min |
| **外部依赖** | 零依赖（不需要 Linear/Jira） | 自建 PM（也是零依赖，但 Web only） |
| **License** | MIT（真正开源） | BSL（假开源） |

### 核心壁垒

1. **记忆网络效应** — Agent 用得越久，知识越深，越难替换。3 个月的 Engineer agent 对你项目的理解是任何新工具无法复制的
2. **原生应用体验** — Mac app 的丝滑感 Electron 永远追不上。iOS 让 CEO 随时随地掌控
3. **CEO Office Agent** — 业界首个「管理 AI 的 AI」产品化实现。不只是看 dashboard，是有个 AI 幕僚长帮你管公司
4. **Multi-Runtime** — 不被单一 AI 厂商锁定。Claude 涨价？切 Gemini。Claude 限速？切 Aider
5. **Composable Persona** — 社区可以贡献 role 和 protocol fragments。像 VSCode extensions 一样
6. **Self-healing** — 大多数故障自动处理，CEO 只处理需要判断的事
7. **MIT License** — 真正的开源。Multica 的 BSL 许可证限制商业使用

---

## 结语

ANC 不是在 AI 浪潮上做一个 yet-another-tool。它是在回答一个更大的问题：

**一个人 + AI，能不能真正运转一家公司？**

答案是可以。但前提是：AI 必须有记忆、有身份、有自我管理能力。ANC 就是让这件事发生的操作系统。

这个 vision 的每一个部分都服务于同一个目标：**让 CEO 只做高杠杆决策，其他一切自动运转。**
