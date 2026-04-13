# ANC Quick Start

## First time setup
```bash
./scripts/install-service.sh
```

## Daily use
- Open http://localhost:3000 (web dashboard)
- Or open ANC.app from Applications (macOS native)
- Create tasks, dispatch agents, review results

## Key pages
- `/tasks` — create + manage tasks, see agent work
- `/pulse` — daily briefing, OKRs, kill switch
- `/members` — agent roster, persona editor
- `/projects` — organize work
- `/inbox` — notifications
- `/settings` — budget, review policy

## Keyboard shortcuts
Press `?` anywhere for full list. Key ones:
- `Cmd+K` — command palette
- `g t` — go to tasks
- `g p` — go to projects
- `j/k` — navigate lists
- `/` — search

## Service management
```bash
./scripts/status.sh           # Check if services are running
./scripts/uninstall-service.sh # Stop and remove services
./scripts/install-service.sh   # Reinstall and restart
```

## Logs
```bash
tail -f /tmp/anc-serve.log     # Backend logs
tail -f /tmp/anc-serve-err.log # Backend errors
tail -f /tmp/anc-web.log       # Web logs
tail -f /tmp/anc-web-err.log   # Web errors
```

## Architecture
- Backend: `localhost:3849` (Node.js + SQLite)
- Web: `localhost:3000` (Next.js)
- Agents run in tmux sessions
