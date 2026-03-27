# Quick-Start Guide

You're a solo founder or small team shipping software. You use Linear to track work. What if every issue you created just... got done?

ANC turns your Linear workspace into an autonomous engineering team. Create an issue, add a label, and an AI agent picks it up — reads the requirements, writes the code, runs the tests, and posts the results back to Linear. No babysitting. No prompt engineering. You review the output like you'd review any engineer's pull request.

This guide gets you from zero to processing your first issue in about 15 minutes.

## What You'll Have When You're Done

- **Three AI agents** (Engineer, Strategist, Ops) that pick up Linear issues automatically
- **Per-issue isolation** — each task gets its own workspace. Agents can't step on each other
- **A dashboard you already know** — Linear is the UI. No new tools to learn
- **Full visibility** — watch agents work in real-time, read their handoff notes, attach to their terminal

## Use Cases

**Solo founder**: You write product specs as Linear issues in the morning. By lunch, your Engineer agent has implementations ready for review. Your Strategist agent has drafted the positioning doc you described in a one-liner.

**Small team (2-5)**: Your human engineers focus on architecture and code review. ANC handles bug fixes, test coverage, routine features, and research tasks. Ops agent monitors system health and triages failures automatically.

**Side project acceleration**: You commit 2 hours on weekends. ANC works the rest of the week — fixing bugs you file from your phone, writing docs, researching libraries.

---

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| **Node.js** | 20.12+ | `node --version` |
| **tmux** | any | `tmux -V` |
| **Claude Code CLI** | latest | `claude --version` |
| **git** | any | `git --version` |

You also need a [Linear](https://linear.app) workspace where you have admin access.

> **Don't have tmux?** `brew install tmux` (macOS) or `apt install tmux` (Linux).

## Step 1: Install

```bash
git clone https://github.com/zzhiyuann/anc.git
cd anc
npm install
npm run build
npm link        # makes `anc` available globally
```

Verify: `anc --help` should show available commands.

## Step 2: Get Your Linear Credentials

You need three values from Linear:

| What | Where to find it |
|------|-----------------|
| **API Key** | [linear.app/settings/api](https://linear.app/settings/api) — create a personal key (starts with `lin_api_`) |
| **Team ID** | Your team's settings page — a UUID like `570e7df2-77ba-4985-843b-5b7718eb7618` |
| **Team Key** | The prefix on your issues (e.g., if issues are `ANC-1`, `ANC-2`, the key is `ANC`) |

## Step 3: Configure Environment

```bash
cp config/env.example .env
```

Edit `.env` with your values:

```bash
# Required — the three values from Step 2
ANC_LINEAR_API_KEY=lin_api_your_key_here
ANC_LINEAR_TEAM_ID=your-team-uuid-here
ANC_LINEAR_TEAM_KEY=ANC

# Optional — sensible defaults
ANC_WEBHOOK_PORT=3849
ANC_WORKSPACE_BASE=~/anc-workspaces
```

Optional integrations (add these later if you want):

| Variable | What it does |
|----------|-------------|
| `ANC_WEBHOOK_SECRET` | Verifies webhook payloads are really from Linear (recommended for production) |
| `ANC_DISCORD_BOT_TOKEN` + `ANC_DISCORD_CHANNEL_ID` | Agents post status updates to a Discord channel |
| `ANC_TELEGRAM_BOT_TOKEN` + `ANC_TELEGRAM_CHAT_ID` | Get mobile alerts when agents finish or fail |

## Step 4: Run Setup

```bash
anc setup
```

This validates your Linear credentials and creates the state directory:

```
~/.anc/
  agents/
    engineer/memory/      # each agent accumulates knowledge across sessions
    strategist/memory/
    ops/memory/
  shared-memory/          # cross-agent knowledge base
  logs/
  state.db                # created on first `anc serve`
```

If setup reports errors, double-check the API key and team ID in your `.env`.

## Step 5: Create Agent Identities in Linear

Each agent needs its own Linear account so it can post comments and update issues under its own name. This is what makes the Linear experience feel like working with real teammates — each agent has a face and a voice.

For each role (`engineer`, `strategist`, `ops`):

1. Create a Linear account (e.g., "Engineer" with email `engineer@yourdomain.com`)
2. Log in as that account and create a personal API key
3. Store the token:

```bash
mkdir -p ~/.anc/agents/engineer
echo "lin_api_engineer_token_here" > ~/.anc/agents/engineer/.oauth-token

mkdir -p ~/.anc/agents/strategist
echo "lin_api_strategist_token_here" > ~/.anc/agents/strategist/.oauth-token

mkdir -p ~/.anc/agents/ops
echo "lin_api_ops_token_here" > ~/.anc/agents/ops/.oauth-token
```

4. Update `config/agents.yaml` with each agent's `linearUserId` (found in workspace member settings)

> **Tip**: Start with just the Engineer agent. You can add Strategist and Ops later.

## Step 6: Set Up the Linear Webhook

ANC reacts to Linear events in real time. You need to expose port 3849 to the internet so Linear can reach it.

### Option A: Cloudflare Tunnel (recommended for getting started)

```bash
brew install cloudflared    # macOS
cloudflared tunnel --url http://localhost:3849
```

Cloudflared prints a public URL like `https://abc123.trycloudflare.com`. Copy it.

### Option B: Direct (server with a public IP)

Use `http://your-server:3849/webhook` directly.

### Create the webhook in Linear

1. Go to workspace settings > Integrations > Webhooks
2. Create a new webhook
3. URL: `https://your-tunnel-url/webhook`
4. Events: **Issues**, **Comments**, **Issue Labels**
5. Signing secret: same as `ANC_WEBHOOK_SECRET` in your `.env` (if set)

## Step 7: Verify Everything

```bash
anc doctor
```

Doctor runs 9 diagnostic checks. You want green across the board:
- Directories and config files
- Environment variables loaded
- Agent tokens present
- Dependencies found (tmux, claude, node, git)
- Linear API connectivity

Fix any red items before continuing. The most common issue is a typo in `.env`.

## Step 8: Start the Gateway

```bash
anc serve
```

The gateway is the brain of the system. It:
- Receives Linear webhooks and routes issues to the right agent
- Manages agent sessions, capacity, and lifecycle
- Runs proactive duties on schedule (health checks, failure postmortems)
- Ticks every 30 seconds to drain the work queue

Keep it running. Verify it's healthy:

```bash
curl http://localhost:3849/health
# {"status":"ok","service":"anc","uptime":5,...}
```

## Step 9: Create Your First Issue

This is the moment. Go to Linear and:

1. Create a new issue in your team
2. Add the label **Bug** or **Feature**
3. Set status to **Todo**

Within 30 seconds, ANC:
- Receives the webhook
- Routes the issue to the Engineer agent
- Creates an isolated workspace at `~/anc-workspaces/ANC-1/`
- Spawns Claude Code in a tmux session
- The agent reads the issue, plans its approach, implements, tests, and writes a `HANDOFF.md`
- ANC posts the handoff as a Linear comment and updates the issue status

**Watch it happen:**

```bash
anc status                  # system overview
anc agent list              # see who's working on what
anc agent jump engineer     # get the tmux attach command
```

When the agent finishes, you'll see a detailed comment on the Linear issue with what was done, how to verify it, and any follow-up actions.

---

## Day-to-Day Operations

### Routing Cheat Sheet

| Label | Agent | Use for |
|-------|-------|---------|
| **Bug** | Engineer | Bug fixes, error investigation |
| **Feature** | Engineer | New features, refactors, tests |
| **Plan** | Strategist | Strategy docs, research, analysis |
| *(no label)* | Ops | Triage, health checks, monitoring |
| `@engineer` in comment | Engineer | Direct mention in any issue |

### Fleet Management

```bash
anc status                          # who's doing what
anc agent list                      # roster + capacity
anc agent start engineer ANC-42     # manually assign an issue
anc agent stop engineer             # stop all engineer sessions
anc agent suspend ANC-42            # pause — free capacity, keep workspace
anc agent resume ANC-42             # resume paused session

anc company start                   # start all agents on the Todo backlog
anc company stop                    # gracefully stop everything
```

### Health & Debugging

```bash
anc doctor                          # full diagnostic check
curl localhost:3849/events?limit=10 # recent event log (JSON)
tmux attach -t anc-ANC-42 -r       # watch an agent work (read-only)
```

---

## Customization

ANC is configured entirely through YAML. No code changes needed.

### Agent Capacity

In `config/agents.yaml`, control how many tasks each agent handles concurrently:

```yaml
agents:
  engineer:
    name: "Engineer"
    maxConcurrency: 5      # max parallel tasks
    dutySlots: 1           # separate pool for proactive duties
```

### Routing Rules

In `config/routing.yaml`, control which agent gets which issues:

```yaml
issue_routing:
  - label: "Bug"              → engineer
  - label: "Feature"          → engineer
  - label: "Plan"             → strategist
  - titlePattern: "\\[Ops\\]" → ops
issue_default: ops
```

### Proactive Duties

In `config/duties.yaml`, schedule recurring tasks that agents run on their own:

```yaml
duties:
  - id: company-pulse
    role: ops
    trigger:
      cron: "2h"
    prompt: "Run system health check, report anomalies"
```

Duties use a separate capacity pool so they never block reactive work.

---

## Troubleshooting

**`anc doctor` shows red for Linear connectivity**
- Verify `ANC_LINEAR_API_KEY` in `.env` starts with `lin_api_`
- Check the key hasn't expired in Linear settings
- Ensure your network can reach `api.linear.app`

**Agent spawns but exits immediately**
- Check `claude --version` — Claude Code CLI must be installed and authenticated
- Attach to the session: `tmux attach -t anc-ANC-<number>`
- Check `~/.anc/logs/` for error output

**Webhook not received**
- Is your tunnel running? (`cloudflared` process alive?)
- Does the Linear webhook URL end in `/webhook`?
- Quick test: `curl -X POST http://localhost:3849/health`

**"No capacity" in logs**
- Each agent has a `maxConcurrency` limit. Check with `anc agent list`
- Free capacity: `anc agent suspend ANC-<number>` or `anc agent stop <role>`

**tmux not found**
- Install: `brew install tmux` (macOS) or `apt install tmux` (Linux)
- ANC checks: PATH, `/opt/homebrew/bin/tmux`, `/usr/local/bin/tmux`, `/usr/bin/tmux`

---

## Development Mode

Hack on ANC itself without a full build:

```bash
npx tsx src/index.ts serve     # run gateway from source
npx tsx src/index.ts doctor    # run diagnostics from source
npx vitest run                 # run tests (115 tests)
npx vitest                     # watch mode
```

---

## What's Next

- **[CEO Guide](CEO-GUIDE.md)** — day-to-day operations: creating issues, reviewing work, interacting with agents
- **`config/`** — customize routing, agent roster, and proactive duties
- **`personas/`** — understand how agent instructions are composed from reusable fragments
- **README** — architecture overview, design decisions, and project structure
