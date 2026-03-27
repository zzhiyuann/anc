# ANC Onboarding Guide

A hands-on guide to setting up ANC and processing your first issue. Each section ends with a verification step so you know you're on track before moving forward.

**Time**: ~20 minutes
**Result**: A running ANC instance that processes Linear issues autonomously

> **Other docs**: [Quick-Start Reference](quick-start.md) for a condensed checklist. [Getting Started Tutorial](getting-started.md) for a narrative walkthrough with use cases.

---

## Prerequisites

Install these before starting:

```bash
# Node.js 20.12+ (required for built-in env loading)
node --version   # must be >= 20.12

# tmux (agent session manager)
brew install tmux   # macOS
# apt install tmux  # Linux

# Claude Code CLI (the AI engine)
npm install -g @anthropic-ai/claude-code

# git
git --version
```

**Verify**: All four commands print version numbers without errors.

---

## Phase 1: Install and Build

```bash
git clone git@github.com:zzhiyuann/anc.git
cd anc
npm install
npm run build
npm link
```

**Verify**:
```bash
anc --help
# Expected: shows commands — setup, serve, doctor, agent, company, status
```

---

## Phase 2: Linear Credentials

You need three values from your Linear workspace:

| Credential | Where | Format |
|---|---|---|
| API Key | [linear.app/settings/api](https://linear.app/settings/api) → Personal API keys → Create | `lin_api_...` |
| Team ID | Team settings URL contains it | UUID (`570e7df2-...`) |
| Team Key | Prefix on your issues (e.g., `ANC-1` → `ANC`) | Short string |

**Verify**: You have all three values written down before continuing.

---

## Phase 3: Environment Configuration

```bash
cd /path/to/anc
cp config/env.example .env
```

Edit `.env` with your values:

```bash
# Required
ANC_LINEAR_API_KEY=lin_api_your_key_here
ANC_LINEAR_TEAM_ID=your-team-uuid
ANC_LINEAR_TEAM_KEY=ANC
ANC_WEBHOOK_PORT=3849
ANC_WORKSPACE_BASE=~/anc-workspaces

# Optional (add later)
# ANC_WEBHOOK_SECRET=your-hmac-secret
# ANC_DISCORD_BOT_TOKEN=...
# ANC_DISCORD_CHANNEL_ID=...
# ANC_TELEGRAM_BOT_TOKEN=...
# ANC_TELEGRAM_CHAT_ID=...
```

**Verify**:
```bash
grep "^ANC_LINEAR_API_KEY=lin_api_" .env && echo "OK" || echo "MISSING"
grep "^ANC_LINEAR_TEAM_ID=" .env && echo "OK" || echo "MISSING"
grep "^ANC_LINEAR_TEAM_KEY=" .env && echo "OK" || echo "MISSING"
```

---

## Phase 4: Agent Identities

Each agent (Engineer, Strategist, Ops) needs its own Linear account so comments appear under the right name.

### Create accounts

For each role, create a Linear account (e.g., `engineer@yourcompany.com`), invite it to your workspace, and generate a personal API key.

### Store tokens

```bash
mkdir -p ~/.anc/agents/{engineer,strategist,ops}

echo "lin_api_ENGINEER_KEY" > ~/.anc/agents/engineer/.oauth-token
echo "lin_api_STRATEGIST_KEY" > ~/.anc/agents/strategist/.oauth-token
echo "lin_api_OPS_KEY" > ~/.anc/agents/ops/.oauth-token
```

### Update agent config

Edit `config/agents.yaml` and set each agent's `linearUserId` to the UUID from the corresponding Linear account.

```yaml
agents:
  engineer:
    linearUserId: "actual-uuid-from-linear"
  # ... same for strategist and ops
```

### Run setup

```bash
anc setup
```

**Verify**:
```bash
# All three token files exist and are non-empty
for role in engineer strategist ops; do
  test -s ~/.anc/agents/$role/.oauth-token && echo "$role: OK" || echo "$role: MISSING"
done
```

---

## Phase 5: Webhook

ANC needs to receive events from Linear. You need to expose your local port to the internet.

### Start a tunnel

```bash
# Option A: Cloudflare Tunnel (recommended)
brew install cloudflared
cloudflared tunnel --url http://localhost:3849
# Copy the printed URL (e.g., https://abc123.trycloudflare.com)

# Option B: ngrok
ngrok http 3849
# Copy the HTTPS URL
```

### Register in Linear

1. **Linear → Settings → API → Webhooks → New webhook**
2. URL: `https://your-tunnel-url/webhook`
3. Secret: same as `ANC_WEBHOOK_SECRET` (if set in `.env`)
4. Events: **Issues** (create, update), **Comments** (create, update), **Issue Labels**
5. Save

**Verify**: The webhook appears in Linear's webhook list with a green status. Keep the tunnel running.

---

## Phase 6: System Check

```bash
anc doctor
```

This runs 9 diagnostic groups:

| Group | What it checks |
|---|---|
| Directories | `~/.anc`, agent memory dirs, workspace base |
| Environment | Required env vars loaded |
| Config Files | `agents.yaml` and `routing.yaml` parse correctly |
| Agent Tokens | `.oauth-token` files exist for each role |
| Dependencies | tmux, claude, node, git on PATH |
| Database | `state.db` exists (created on first `anc serve`) |
| Linear API | API key works, team found |
| Gateway | Health endpoint responds (only if gateway is running) |
| Tmux Sessions | Lists active `anc-*` sessions |

**Verify**: All checks pass (green). Gateway and Database warnings are expected — they initialize on first `anc serve`.

Common fixes:
- **Missing env vars** → Check `.env` is in the project root, not a subdirectory
- **tmux not found** → `brew install tmux`, then restart terminal
- **Linear API fails** → Regenerate the API key in Linear settings
- **Agent token missing** → Re-check paths: `~/.anc/agents/<role>/.oauth-token`

---

## Phase 7: Start the Gateway

```bash
anc serve
```

The gateway:
- Listens for Linear webhooks on the configured port
- Routes issues to agents based on `config/routing.yaml`
- Manages session lifecycle (spawn, idle, suspend, resume)
- Runs a 30-second tick loop for queue draining and cleanup
- Executes proactive duties from `config/duties.yaml`

**Verify**:
```bash
# In another terminal:
curl -s http://localhost:3849/health | python3 -m json.tool
# Expected: {"status":"ok","service":"anc","uptime":...}
```

Leave the gateway running.

---

## Phase 8: First Issue

Create an issue in Linear:

1. **Title**: Any real task (e.g., "Add input validation to signup form")
2. **Label**: `Bug`, `Feature`, or `agent:cc`
3. **Description**: Write as you would for a teammate — context matters
4. **Status**: Set to **Todo**

### What happens

```
Linear webhook → Gateway → Router → Runtime → tmux session (Claude Code)
```

1. Gateway receives the webhook, emits `issue:created`
2. Router matches the label to an agent (Bug/Feature → Engineer)
3. Runtime checks capacity, creates workspace at `~/anc-workspaces/<issue-key>/`
4. Spawner starts Claude Code in a tmux session with the issue context
5. Agent reads, plans, implements, tests, writes `HANDOFF.md`
6. ANC detects completion, posts results to Linear, updates issue to **In Review**

### Watch it

```bash
anc status                          # overview of all sessions
anc agent list                      # agent roster and capacity
tmux list-sessions | grep anc       # raw tmux sessions
```

To attach to the agent's terminal and watch it work:

```bash
anc agent jump engineer
# Detach: Ctrl+B, then D
```

**Verify**: The issue moves to **In Progress**, then **In Review**. A comment appears on the Linear issue with the agent's handoff summary.

---

## After Setup: Key Operations

### Issue routing

Default routing from `config/routing.yaml`:

| Label / Pattern | Agent |
|---|---|
| `agent:cc`, `Bug`, `Feature`, `Improvement` | Engineer |
| `Plan`, title `[Strategy]`, title `[Research]` | Strategist |
| No match (default) | Ops |
| `@engineer` in comment | Engineer (direct mention) |

### Fleet management

```bash
anc status                          # system overview
anc agent list                      # roster + capacity
anc agent start engineer ANC-5      # manually assign issue
anc agent suspend ANC-5             # pause session (keeps workspace)
anc agent resume ANC-5              # resume paused session
anc agent stop engineer             # stop all sessions for a role
anc company start                   # start all agents on Todo backlog
anc company stop                    # gracefully stop everything
```

### Session lifecycle

Agents move through three states automatically:

```
Active → Idle → Suspended
  ↑                ↓
  └── Resume ──────┘
```

- **Active**: Agent is working. Uses capacity slot + tmux session.
- **Idle**: Work finished, session kept warm. Resumes instantly on new comments.
- **Suspended**: tmux session killed, workspace preserved. Resumes by re-spawning.

### Configuration files

| File | Purpose |
|---|---|
| `config/agents.yaml` | Agent roster: names, capacity, persona composition |
| `config/routing.yaml` | Issue and comment routing rules |
| `config/duties.yaml` | Proactive scheduled tasks |
| `.env` | Environment variables (credentials, ports) |
| `personas/` | Agent instruction fragments (base, role, protocols) |

### Health monitoring

```bash
anc doctor                                  # full 9-point diagnostic
curl -s localhost:3849/health               # gateway liveness
curl -s "localhost:3849/events?limit=10"    # recent event log
```

The `/health` endpoint includes `lastWebhookAt` and `webhookCount` — if `lastWebhookAt` is null and the gateway has been running for a while, webhooks aren't reaching it.

---

## Troubleshooting

### Agent not picking up issues

1. Is the gateway running? `curl localhost:3849/health`
2. Is the tunnel alive? Check the cloudflared/ngrok process
3. Does the label match a routing rule? `cat config/routing.yaml`
4. Is there capacity? `anc agent list`

### Agent spawns but exits immediately

1. Is Claude Code authenticated? `claude --version`
2. Check the tmux session: `tmux attach -t anc-<issue-key>`
3. Check logs: `ls ~/.anc/logs/`

### Webhook not arriving

1. Tunnel process still running?
2. Linear webhook URL ends in `/webhook`?
3. Webhook secret matches between Linear and `.env`?
4. Test gateway: `curl -X POST localhost:3849/health`

### Rate limit errors (429)

Normal during high activity. ANC uses exponential backoff (up to 30s cap). If persistent, reduce `maxConcurrency` in `config/agents.yaml`.

### "No capacity" warnings

Each agent has `maxConcurrency` slots. Free capacity by suspending or stopping sessions:

```bash
anc agent suspend ANC-<number>
anc agent stop <role>
```

---

## Next Steps

- **Clear your backlog** — Create 5-10 well-described issues, label them, let agents work overnight
- **Customize routing** — Edit `config/routing.yaml` to match your label conventions
- **Add duties** — Uncomment templates in `config/duties.yaml` for automated health checks
- **Set up notifications** — Add Discord or Telegram credentials to `.env` for completion alerts
- **Read the [CEO Guide](CEO-GUIDE.md)** — Best practices for writing issues and managing the review flow
