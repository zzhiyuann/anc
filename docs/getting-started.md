# Getting Started with ANC

You have a Linear backlog full of bugs, features, and research tasks. You're context-switching between all of them. What if you could label an issue and have an AI agent pick it up, write the code, post updates to the issue thread, and notify you when it's ready for review?

That's ANC. This tutorial gets you from zero to your first autonomous issue in about 30 minutes.

**Time**: ~30 minutes
**Prerequisites**: macOS or Linux, Node.js 20+, a Linear workspace

> Already familiar with the concepts? See the [Quick-Start Reference](quick-start.md) for a condensed checklist.

---

## Table of Contents

1. [Why ANC?](#why-anc)
2. [What You'll Build](#what-youll-build)
3. [Install ANC](#install-anc)
4. [Set Up Linear Credentials](#set-up-linear-credentials)
5. [Configure Your Environment](#configure-your-environment)
6. [Create Agent Identities](#create-agent-identities)
7. [Set Up the Webhook](#set-up-the-webhook)
8. [Verify Everything](#verify-everything)
9. [Start the Gateway](#start-the-gateway)
10. [Create Your First Issue](#create-your-first-issue)
11. [What Happens Next](#what-happens-next)
12. [Real-World Use Cases](#real-world-use-cases)
13. [Day-to-Day Operations](#day-to-day-operations)
14. [Troubleshooting](#troubleshooting)

---

## Why ANC?

If you're a solo founder or on a small team (1–5 people), you already know the bottleneck isn't ideas — it's execution bandwidth. You triage issues in Linear, but most of them sit in the backlog because there aren't enough hands.

ANC turns your Linear workspace into a dispatch system for AI agents. Instead of managing agents through chat windows or custom scripts, you work the way you already work — create issues, add labels, write descriptions — and ANC handles the rest.

**What makes it different from other agent frameworks:**

- **Linear is the UI.** No dashboards to learn, no new tools to adopt. Your project management tool becomes your agent control plane.
- **Per-issue isolation.** Each agent session gets its own workspace, tmux session, and context. Agents don't step on each other's work.
- **Session lifecycle.** Agents move through Active → Idle → Suspended states automatically. They don't waste resources sitting idle — and they resume cleanly when you need them.
- **Agents collaborate through your issue tracker.** Engineer finishes a feature, dispatches to Strategist for docs, who dispatches to Ops for verification. The entire chain lives on one Linear issue thread.

ANC isn't a general-purpose agent framework. It's purpose-built for software engineering teams that use Linear and want to multiply their output without multiplying their headcount.

---

## What You'll Build

By the end of this tutorial, you'll have:

- **Three AI agents** (Engineer, Strategist, Ops) running on your machine
- **A gateway** that listens for Linear webhooks and routes issues to the right agent
- **Per-issue workspaces** where agents do their work in isolation
- **Notifications** in Discord or Telegram when work is done (optional)

The whole system runs on a single machine — no cloud infrastructure, no containers, no Kubernetes. Just your laptop, Linear, and Claude Code.

---

## Install ANC

First, install the system dependencies ANC needs:

```bash
# tmux — ANC runs each agent in a tmux session
brew install tmux

# Claude Code CLI — the AI engine behind each agent
npm install -g @anthropic-ai/claude-code
```

Then clone and build ANC:

```bash
git clone git@github.com:zzhiyuann/anc.git
cd anc
npm install
npm run build
npm link        # makes the `anc` command available globally
```

Verify the install:

```bash
anc --help
```

You should see commands like `setup`, `serve`, `doctor`, `agent`, and `company`.

---

## Set Up Linear Credentials

ANC needs three things from Linear:

| Credential | What it is | Where to find it |
|---|---|---|
| **API Key** | Personal API key for the ANC system | Linear → Settings → API → Personal API keys |
| **Team ID** | UUID of your team | Linear → Settings → Team → copy the ID from the URL |
| **Team Key** | Short prefix (e.g., `ANC`) | The prefix that appears before issue numbers |

### Create the API key

1. Go to **Linear → Settings → API → Personal API keys**
2. Create a new key with a descriptive name like `anc-orchestrator`
3. Copy the key — it starts with `lin_api_`

### Find your team ID and key

1. Go to **Linear → Settings → Teams → [Your Team]**
2. The URL contains the team ID: `linear.app/settings/teams/<team-id>`
3. The team key is the short prefix shown next to issue numbers (e.g., issues are `ANC-1`, `ANC-2` → team key is `ANC`)

---

## Configure Your Environment

Copy the example config and fill in your credentials:

```bash
cp config/env.example .env
```

Edit `.env` with your values:

```bash
# Required — Linear API
ANC_LINEAR_API_KEY=lin_api_your_key_here
ANC_LINEAR_TEAM_ID=your-team-uuid-here
ANC_LINEAR_TEAM_KEY=ANC

# Required — Webhook
ANC_WEBHOOK_PORT=3849
ANC_WEBHOOK_SECRET=pick-a-random-string

# Required — Workspaces
ANC_WORKSPACE_BASE=~/anc-workspaces

# Optional — Discord notifications
ANC_DISCORD_BOT_TOKEN=your-discord-bot-token
ANC_DISCORD_CHANNEL_ID=your-channel-id
ANC_DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...

# Optional — Telegram notifications
ANC_TELEGRAM_BOT_TOKEN=your-telegram-bot-token
ANC_TELEGRAM_CHAT_ID=your-chat-id
```

The workspace base directory is where ANC creates per-issue workspaces. Each agent session gets its own directory (e.g., `~/anc-workspaces/ANC-42/`).

---

## Create Agent Identities

Each ANC agent needs its own Linear account so it can post comments as itself. You'll create three accounts: **Engineer**, **Strategist**, and **Ops**.

### Why separate accounts?

When an agent comments on an issue, you want to see "Engineer commented" or "Strategist commented" — not a generic bot name. Separate accounts also let Linear's notification system work naturally.

### Steps for each agent

1. Create a Linear account for the agent (e.g., `engineer@yourcompany.com`)
2. Invite it to your workspace and team
3. Generate a personal API key for that account
4. Store the token:

```bash
# Create the token directories
mkdir -p ~/.anc/agents/engineer
mkdir -p ~/.anc/agents/strategist
mkdir -p ~/.anc/agents/ops

# Save each agent's API key
echo "lin_api_engineer_key" > ~/.anc/agents/engineer/.oauth-token
echo "lin_api_strategist_key" > ~/.anc/agents/strategist/.oauth-token
echo "lin_api_ops_key" > ~/.anc/agents/ops/.oauth-token
```

Then update `config/agents.yaml` with the correct `linearUserId` for each agent. You can find each account's user ID from Linear's API or the account settings URL.

### Run initial setup

```bash
anc setup
```

This creates the necessary directories and validates your configuration.

---

## Set Up the Webhook

ANC receives events from Linear via webhooks. Linear needs to reach your machine over HTTPS.

### Option A: Cloudflare Tunnel (recommended)

If you have a domain with Cloudflare:

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Create a tunnel pointing to your ANC port
cloudflared tunnel create anc
cloudflared tunnel route dns anc anc.yourdomain.com
cloudflared tunnel run --url http://localhost:3849 anc
```

Your webhook URL will be: `https://anc.yourdomain.com/webhook`

### Option B: ngrok (quick testing)

```bash
ngrok http 3849
```

Use the generated HTTPS URL + `/webhook` as your webhook endpoint.

### Register the webhook in Linear

1. Go to **Linear → Settings → API → Webhooks**
2. Click **New webhook**
3. Set the URL to your endpoint (e.g., `https://anc.yourdomain.com/webhook`)
4. Set the secret to the same value as `ANC_WEBHOOK_SECRET` in your `.env`
5. Select these event types:
   - **Issues**: create, update
   - **Comments**: create, update
6. Save

---

## Verify Everything

ANC includes a built-in diagnostic tool that checks every component:

```bash
anc doctor
```

You'll see a checklist of 9 validation groups:

```
ANC Doctor
──────────

Directories
  ✓ ~/.anc exists
  ✓ Agent memory directories exist
  ✓ Workspace base exists

Environment Variables
  ✓ ANC_LINEAR_API_KEY is set
  ✓ ANC_LINEAR_TEAM_ID is set
  ✓ ANC_LINEAR_TEAM_KEY is set
  ✓ ANC_WEBHOOK_PORT is set

Config Files
  ✓ agents.yaml is valid
  ✓ routing.yaml is valid

Agent Tokens
  ✓ engineer token exists
  ✓ strategist token exists
  ✓ ops token exists

Dependencies
  ✓ tmux found
  ✓ claude found
  ✓ node found
  ✓ git found

Linear Connectivity
  ✓ API key valid
  ✓ Team found

──────────
16 passed, 0 failed, 0 warnings
```

Fix any failures before proceeding. Common issues:

- **Missing env vars** — Check your `.env` file is in the project root
- **Missing agent tokens** — Re-check the paths in `~/.anc/agents/`
- **tmux not found** — Run `brew install tmux`
- **Linear connectivity fails** — Verify your API key is correct and not expired

---

## Start the Gateway

```bash
anc serve
```

This starts the ANC gateway, which:

1. Loads your `.env` configuration
2. Registers event handlers for issues, comments, sessions, and lifecycle events
3. Recovers any existing tmux sessions from a previous run
4. Starts listening for Linear webhooks on the configured port
5. Runs a 30-second tick loop for cleanup and health checks

You should see output like:

```
ANC gateway listening on :3849
Recovered 0 existing sessions
Ready for webhooks
```

Leave this running in a terminal (or use `tmux` to background it).

---

## Create Your First Issue

This is the moment it all clicks. Go to Linear and create an issue:

1. **Title**: `Add input validation to the signup form` (or any real task from your backlog)
2. **Label**: Add the `agent:cc` label (create it if it doesn't exist)
3. **Description**: Write what you'd write for a teammate — the more context, the better the result
4. **Status**: Set to **Todo**

### What happens

Within seconds, ANC processes the webhook:

1. **Gateway** receives the webhook from Linear → emits an `issue:created` event
2. **Router** matches the `agent:cc` label → assigns it to **Engineer**
3. **Runtime** checks capacity → creates workspace at `~/anc-workspaces/ANC-1/`
4. **Spawner** starts a tmux session with Claude Code, seeded with the issue context
5. The agent reads the issue, plans its approach, and starts working

### Watch it work

```bash
# See active sessions
anc status

# Attach to the agent's tmux session to watch live
anc agent jump engineer
# (detach with Ctrl+B, D)
```

### When the agent finishes

The agent writes a `HANDOFF.md` file in its workspace. ANC detects this, marks the session complete, and moves the Linear issue to **In Review** — the same status transition a human teammate would make.

You get a notification in Discord or Telegram (if configured) with a summary of what was done. Open the Linear issue to see the agent's comments, review the code in the workspace, and either close the issue or leave a comment to send the agent back for revisions.

That's the core loop: **create issue → agent works → you review**. Everything else builds on top of it.

---

## What Happens Next

### Review the work

Check the issue in Linear. The agent will have posted comments describing its approach and findings. The workspace at `~/anc-workspaces/ANC-1/` contains all files the agent created or modified.

### Issue lifecycle

The typical flow for an issue:

```
Backlog → Todo → In Progress → In Review → Done
          ↑        ↑              ↑          ↑
        You set  ANC sets      Agent sets  You set
```

- **You** move issues to Todo (or create them there directly)
- **ANC** picks them up and sets In Progress
- **Agents** write HANDOFF.md and set In Review
- **You** review and either close (Done) or add a comment for the agent to continue

### Routing rules

Issues are routed based on your `config/routing.yaml`:

| Trigger | Route |
|---|---|
| Label `agent:cc` or `Bug` | → Engineer |
| Label `Feature` | → Engineer |
| Label `Plan` | → Strategist |
| Title contains `[Strategy]` | → Strategist |
| Title contains `[Research]` | → Strategist |
| Default (no match) | → Ops |

### Chain dispatch

Agents can hand off work to each other on the same issue. For example, Engineer writes a technical doc, then dispatches to Strategist for positioning, who dispatches to Ops for final verification — all on the same Linear issue thread.

---

## Real-World Use Cases

Here's how teams actually use ANC day to day.

### Solo founder shipping a SaaS

You're building a product alone. Your morning routine:

1. Triage last night's bug reports — label them `Bug`, agents pick them up
2. Write a one-paragraph feature description — label it `Feature`, Engineer builds it
3. Need a landing page rewrite? Create an issue with `[Strategy]` in the title — Strategist drafts it

You review completed work over lunch. What used to be a week's backlog moves in a day.

### Small team (2–5 engineers) with a growing backlog

Your team handles the critical path. ANC handles the rest:

- **Bug triage**: Label incoming bugs → Engineer investigates, writes a fix, posts a PR link in the issue thread
- **Documentation**: New feature shipped? Create a docs issue → Engineer writes the technical docs → Strategist polishes for users
- **Research tasks**: Need to evaluate a library or compare approaches? Create a `[Research]` issue → Strategist produces a structured comparison

Your team stays focused on architecture decisions and customer-facing work. The agents handle the tasks that are well-defined but time-consuming.

### Side project acceleration

You have a side project you work on evenings and weekends. Before bed, create 3–4 issues describing what you want built. Wake up to completed work, review it over coffee, and ship.

---

## Day-to-Day Operations

### Fleet management

```bash
# Overview of all sessions
anc status

# List agent roster and their state
anc agent list

# Manually start an agent on an issue
anc agent start engineer ANC-42

# Suspend a session (frees capacity, keeps workspace)
anc agent suspend ANC-42

# Resume a suspended session
anc agent resume ANC-42

# Stop all sessions for a role
anc agent stop engineer
```

### Health check

```bash
# Full diagnostic
anc doctor

# Quick gateway health (from another terminal)
curl http://localhost:3849/health
```

The `/health` endpoint returns uptime, webhook count, and last webhook timestamp — useful for detecting a "zombie" gateway that's running but not receiving events.

### Company-wide controls

```bash
# Start all agents on their Todo backlogs
anc company start

# Gracefully stop everything
anc company stop

# Fleet overview
anc company status
```

### Capacity

Each agent has two capacity pools defined in `config/agents.yaml`:

- **maxConcurrency** — Maximum simultaneous issue sessions (default: 5)
- **dutySlots** — Reserved slots for proactive duties like health checks (default: 1)

This prevents duty tasks from being starved when agents are at full capacity.

---

## Troubleshooting

### Agent not picking up issues

1. Check the gateway is running: `curl http://localhost:3849/health`
2. Check the webhook is registered in Linear and the URL is reachable
3. Verify routing rules match your issue's labels: `cat config/routing.yaml`
4. Check agent capacity: `anc status`
5. Run diagnostics: `anc doctor`

### Agent session crashed

ANC automatically recovers tmux sessions on restart. If a session is stuck:

```bash
# Check what's in tmux
tmux list-sessions | grep anc

# Force-stop the session
anc agent stop engineer

# Restart the gateway to recover cleanly
# Ctrl+C the gateway, then:
anc serve
```

### Webhook not arriving

1. Check your tunnel is running (cloudflared/ngrok)
2. Verify the webhook secret matches between Linear and your `.env`
3. Check gateway logs for incoming requests
4. Test manually: `curl -X POST http://localhost:3849/health`

### "Rate limited" errors

ANC includes exponential backoff for Linear API rate limits. If you see 429 errors, the system will automatically retry with increasing delays (up to 30 seconds). This is normal during high-activity periods with multiple agents.

### Common `anc doctor` failures

| Check | Fix |
|---|---|
| Missing env vars | Ensure `.env` is in the ANC project root directory |
| Agent token missing | Create token file at `~/.anc/agents/<role>/.oauth-token` |
| tmux not found | `brew install tmux` |
| Linear API fails | Regenerate your API key in Linear settings |
| Database missing | Run `anc serve` once to initialize, then Ctrl+C |

---

## Next Steps

You have a working ANC setup. Here's where to go from here:

- **Start clearing your backlog.** Create 5–10 issues with good descriptions, label them, and let agents work overnight. Review in the morning.
- **Customize routing** — Edit `config/routing.yaml` to match your team's label conventions. Route `Bug` to Engineer, `Docs` to Strategist, `Infra` to Ops — whatever fits your workflow.
- **Add proactive duties** — Define scheduled tasks in `config/duties.yaml`. Agents can run health checks, scan for tech debt, or produce status reports on a cron schedule — without you creating an issue.
- **Set up Discord or Telegram** — Get real-time notifications when agents complete work. You'll know the moment something is ready for review.
- **Read the [CEO Guide](CEO-GUIDE.md)** — Best practices for writing issues that agents execute well, interacting with agents via comments, and managing the review flow.
- **Explore the [Architecture Overview](../README.md)** — Understand the event bus, session lifecycle, and routing engine in depth.
