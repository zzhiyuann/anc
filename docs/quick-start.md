# Quick-Start Guide

Get ANC running and process your first issue in under 15 minutes.

## Prerequisites

| Tool | Version | Check |
|------|---------|-------|
| **Node.js** | 20.12+ | `node --version` |
| **tmux** | any | `tmux -V` |
| **Claude Code CLI** | latest | `claude --version` |
| **git** | any | `git --version` |

You also need a [Linear](https://linear.app) workspace where you have admin access.

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

**API Key**
1. Go to [linear.app/settings/api](https://linear.app/settings/api)
2. Create a new personal API key
3. Copy it — it starts with `lin_api_`

**Team ID**
1. Go to your team's settings page
2. Find the team UUID (a long string like `570e7df2-77ba-4985-843b-5b7718eb7618`)

**Team Key**
1. This is the short prefix on your issues (e.g., if your issues are `ANC-1`, `ANC-2`, the team key is `ANC`)

## Step 3: Configure Environment

```bash
cp config/env.example .env
```

Edit `.env` with your values:

```bash
# Required
ANC_LINEAR_API_KEY=lin_api_your_key_here
ANC_LINEAR_TEAM_ID=your-team-uuid-here
ANC_LINEAR_TEAM_KEY=ANC

# Optional — defaults shown
ANC_WEBHOOK_PORT=3849
ANC_WORKSPACE_BASE=~/anc-workspaces
```

Optional integrations:

| Variable | Purpose |
|----------|---------|
| `ANC_WEBHOOK_SECRET` | HMAC secret for verifying Linear webhook signatures |
| `ANC_DISCORD_BOT_TOKEN` | Discord bot for bidirectional agent updates |
| `ANC_DISCORD_CHANNEL_ID` | Discord channel to post to |
| `ANC_TELEGRAM_BOT_TOKEN` | Telegram bot for outbound alerts |
| `ANC_TELEGRAM_CHAT_ID` | Telegram chat to send alerts to |

## Step 4: Run Setup

```bash
anc setup
```

This creates the directory structure:

```
~/.anc/
  agents/
    engineer/memory/
    strategist/memory/
    ops/memory/
  shared-memory/
  logs/
  state.db              # created on first `anc serve`
```

Setup validates your Linear API key and team ID. If either fails, double-check your `.env` values.

## Step 5: Create Agent Identities in Linear

Each ANC agent needs its own Linear user account and OAuth token. This is how agents post comments and update issues under their own identity.

For each agent role (`engineer`, `strategist`, `ops`):

1. Create a Linear account for the agent (e.g., "Engineer" with email `engineer@yourdomain.com`)
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

4. Update `config/agents.yaml` with each agent's `linearUserId` (found in Linear workspace member settings)

## Step 6: Set Up Linear Webhook

ANC needs to receive Linear events. You have two options:

### Option A: Cloudflare Tunnel (recommended for local dev)

```bash
# Install cloudflared
brew install cloudflared    # macOS

# Start a tunnel
cloudflared tunnel --url http://localhost:3849
```

Use the generated URL (e.g., `https://abc123.trycloudflare.com`) as your webhook endpoint.

### Option B: Direct (if server is publicly accessible)

Use `http://your-server:3849/webhook` directly.

### Create the webhook in Linear

1. Go to your Linear workspace settings > Integrations > Webhooks
2. Create a new webhook
3. Set the URL to `https://your-tunnel-url/webhook` (or `http://your-server:3849/webhook`)
4. Select events: **Issues**, **Comments**, **Issue Labels**
5. If you set `ANC_WEBHOOK_SECRET`, enter the same value as the signing secret

## Step 7: Verify Setup

```bash
anc doctor
```

You should see green checks for:
- Directories exist
- Environment variables loaded
- Config files parse correctly
- Agent tokens present
- Dependencies (tmux, claude, node, git) found
- Linear API connectivity
- (Gateway check passes after `anc serve` is running)

Fix any red items before continuing.

## Step 8: Start the Gateway

```bash
anc serve
```

The gateway starts on port 3849 (or your configured `ANC_WEBHOOK_PORT`). It:
- Receives Linear webhooks
- Routes issues to agents
- Manages agent sessions and capacity
- Runs proactive duties on schedule
- Ticks every 30 seconds for queue management

Keep this running — it's the brain of the system.

Verify it's healthy:

```bash
curl http://localhost:3849/health
# {"status":"ok","service":"anc","uptime":5,...}
```

## Step 9: Process Your First Issue

1. Create a new issue in your Linear team
2. Add a label: **Bug** or **Feature** (routes to Engineer)
3. Set status to **Todo**

Within 30 seconds, ANC will:
- Receive the webhook
- Route the issue to the Engineer agent
- Create an isolated workspace at `~/anc-workspaces/ANC-1/`
- Spawn Claude Code in a tmux session
- The agent reads the issue, plans, implements, and writes `HANDOFF.md`
- ANC posts the handoff as a Linear comment and updates the issue status

Watch it happen:

```bash
# See system overview
anc status

# See active sessions
anc agent list

# Attach to an agent's terminal (read-only)
anc agent jump engineer
# Then: tmux attach -t anc-ANC-1 -r
```

## Common Operations

```bash
# Fleet management
anc status                          # overview of all agents
anc agent list                      # roster + capacity
anc agent start engineer ANC-42     # manually spawn on specific issue
anc agent stop engineer             # stop all engineer sessions
anc agent suspend ANC-42            # preserve workspace, free capacity
anc agent resume ANC-42             # resume suspended session

# Start/stop all agents
anc company start                   # activate all agents on Todo backlog
anc company stop                    # gracefully stop everything

# Health
anc doctor                          # full diagnostic check
curl localhost:3849/events?limit=10 # recent event log
```

## Customization

### Agent Roster

Edit `config/agents.yaml` to adjust capacity or add agents:

```yaml
agents:
  engineer:
    name: "Engineer"
    maxConcurrency: 5      # max active sessions
    dutySlots: 1           # separate pool for proactive duties
    # ...
```

### Routing Rules

Edit `config/routing.yaml` to change how issues are assigned:

```yaml
issue_routing:
  - label: "Bug"              → engineer
  - label: "Feature"          → engineer
  - label: "Plan"             → strategist
  - titlePattern: "\\[Ops\\]" → ops
issue_default: ops
```

### Proactive Duties

Edit `config/duties.yaml` to schedule recurring tasks:

```yaml
duties:
  - id: company-pulse
    role: ops
    trigger:
      cron: "2h"
    prompt: "Run system health check, report anomalies"
```

## Troubleshooting

**`anc doctor` shows red for Linear connectivity**
- Verify `ANC_LINEAR_API_KEY` in `.env` starts with `lin_api_`
- Check the key hasn't expired in Linear settings
- Ensure your network can reach `api.linear.app`

**Agent spawns but exits immediately**
- Check `claude --version` works — Claude Code CLI must be installed and authenticated
- Look at tmux session output: `tmux attach -t anc-ANC-<number>`
- Check `~/.anc/logs/` for error details

**Webhook not received**
- Verify your tunnel is running (`cloudflared` or public URL)
- Check Linear webhook settings — the URL should end in `/webhook`
- Test manually: `curl -X POST http://localhost:3849/health`

**"No capacity" in logs**
- Agents have `maxConcurrency` limits. Check `anc agent list` for current usage
- Suspend or stop idle sessions: `anc agent suspend ANC-<number>`

**tmux not found**
- Install: `brew install tmux` (macOS) or `apt install tmux` (Linux)
- ANC looks for tmux at: PATH, `/opt/homebrew/bin/tmux`, `/usr/local/bin/tmux`, `/usr/bin/tmux`

## Development Mode

Run without building:

```bash
npx tsx src/index.ts serve     # start gateway
npx tsx src/index.ts doctor    # run diagnostics
npx vitest run                 # run tests (115 tests)
npx vitest                     # watch mode
```

## What's Next

- Read the [CEO Guide](CEO-GUIDE.md) for day-to-day operations (creating issues, reviewing work, managing agents)
- Explore `config/` to customize routing, agents, and duties
- Check `personas/` to understand how agent instructions are composed
